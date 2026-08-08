/**
 * Where each card sits on the organisation chart.
 *
 * PURE — no environment, no Node API, no database. The browser imports this to
 * draw the chart and the server imports it to reject a reporting line that would
 * create a loop, and there must be exactly one implementation of "who reports to
 * whom" or the two can disagree. Same rule and same reason as `ticket.ts`,
 * `equipment.ts` and `attachments.ts`: `process.env` in a client bundle is
 * silently `undefined`, so anything that reads configuration cannot live here.
 *
 * ## Auto-layout, with a hand override
 *
 * The chart lays itself out from the reporting lines. A card someone has dragged
 * carries `pos_x` / `pos_y` and is drawn there instead — its children keep their
 * automatic places and the connecting line simply follows. That is the whole
 * arrangement, and it is what makes the chart survive a new hire: adding a
 * person nobody has dragged costs no layout work at all.
 *
 * ## Nothing here may hang or throw
 *
 * `layoutOrgChart` is called during render. A row whose manager is missing, or
 * one that is somehow its own grandparent, must produce a slightly odd chart
 * rather than an infinite walk up the tree — `resolveParents` below drops the
 * offending link and the person becomes a root. The server prevents both cases
 * on the way in (see `wouldCycle`), but a renderer that trusts its input is one
 * hand-written `UPDATE` away from a browser tab that never paints.
 */

/** Card geometry, in CSS pixels. The component reads these rather than repeating them. */
export const CARD_W = 210;
export const CARD_H = 86;
/** Between siblings, and between one generation and the next. */
export const H_GAP = 26;
export const V_GAP = 58;
/** Breathing room around the whole chart, so a card is never flush to the edge. */
export const CANVAS_PAD = 32;

/** The row shape the layout needs. The real row carries more; this is the subset. */
export interface OrgNodeInput {
  id: string;
  name: string;
  manager_id: string | null;
  sort_order: number | null;
  pos_x: number | null;
  pos_y: number | null;
}

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  /** Generations below the top of the chart. 0 is a root. */
  depth: number;
  /** True when this position came from `pos_x`/`pos_y` rather than the layout. */
  moved: boolean;
}

export interface OrgEdge {
  managerId: string;
  reportId: string;
}

export interface OrgLayout {
  nodes: PlacedNode[];
  edges: OrgEdge[];
  /** Surface size, including `CANVAS_PAD` on every side. */
  width: number;
  height: number;
}

/**
 * Each person's effective manager, with dangling and circular links dropped.
 *
 * Three things are treated as "no manager": an unset column, a manager id that
 * is not in the set (a row deleted between the read and the render), and a link
 * whose chain leads back to the person themselves. The last is the one that
 * matters — see the note at the top of the file.
 */
export function resolveParents(people: readonly OrgNodeInput[]): Map<string, string | null> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const parents = new Map<string, string | null>();

  for (const person of people) {
    let candidate = person.manager_id;
    if (!candidate || candidate === person.id || !byId.has(candidate)) {
      parents.set(person.id, null);
      continue;
    }
    // Walk up from the candidate. If we arrive back at this person, the link
    // closes a loop and is dropped. Bounded by the node count, so it terminates
    // even on data that is cyclic in some other way.
    const seen = new Set<string>([person.id]);
    let cursor: string | null = candidate;
    let loops = false;
    for (let step = 0; cursor && step <= people.length; step++) {
      if (seen.has(cursor)) {
        loops = true;
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.manager_id ?? null;
    }
    parents.set(person.id, loops ? null : candidate);
  }
  return parents;
}

/**
 * Would making `managerId` the manager of `personId` close a loop?
 *
 * The server's guard. Answering from the same parent map the renderer uses is
 * the point: a chart that draws and a chart that saves have to agree on what a
 * cycle is. Answers true for the self-referential case as well.
 */
export function wouldCycle(
  people: readonly OrgNodeInput[],
  personId: string,
  managerId: string | null,
): boolean {
  if (!managerId) return false;
  if (managerId === personId) return true;

  const byId = new Map(people.map((p) => [p.id, p]));
  if (!byId.has(managerId)) return false; // A dangling id is rejected elsewhere.

  // Walk up from the PROPOSED manager. Reaching this person means the new link
  // would close the circle.
  let cursor: string | null = managerId;
  for (let step = 0; cursor && step <= people.length; step++) {
    if (cursor === personId) return true;
    cursor = byId.get(cursor)?.manager_id ?? null;
  }
  return false;
}

/** Siblings read left to right: hand-set order first, then name, then id. */
function compareSiblings(a: OrgNodeInput, b: OrgNodeInput): number {
  const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
  const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  const byName = a.name.localeCompare(b.name);
  // The id is the tiebreak so the layout is deterministic — two people with the
  // same name would otherwise swap places between the server render and the
  // client's, which React reports as a hydration mismatch.
  return byName !== 0 ? byName : a.id.localeCompare(b.id);
}

/**
 * Place every card.
 *
 * A single-pass tidy tree: leaves take the next free column, and a manager is
 * centred over their first and last report. Good enough for an org chart — the
 * classic Reingold–Tilford second pass exists to compact subtrees that this
 * leaves slightly wide, and at the size of a company's leadership the difference
 * is invisible.
 */
export function layoutOrgChart(people: readonly OrgNodeInput[]): OrgLayout {
  if (people.length === 0) {
    return { nodes: [], edges: [], width: CANVAS_PAD * 2, height: CANVAS_PAD * 2 };
  }

  const parents = resolveParents(people);
  const byId = new Map(people.map((p) => [p.id, p]));

  const children = new Map<string, OrgNodeInput[]>();
  const roots: OrgNodeInput[] = [];
  for (const person of people) {
    const parent = parents.get(person.id) ?? null;
    if (parent === null) {
      roots.push(person);
      continue;
    }
    const list = children.get(parent);
    if (list) list.push(person);
    else children.set(parent, [person]);
  }
  roots.sort(compareSiblings);
  for (const list of children.values()) list.sort(compareSiblings);

  const auto = new Map<string, { x: number; y: number; depth: number }>();
  let nextColumn = 0;

  /** Returns the centre x of the subtree rooted at `id`. */
  function place(id: string, depth: number): number {
    const kids = children.get(id) ?? [];
    const y = depth * (CARD_H + V_GAP);

    if (kids.length === 0) {
      const x = nextColumn * (CARD_W + H_GAP);
      nextColumn += 1;
      auto.set(id, { x, y, depth });
      return x;
    }

    const centres = kids.map((kid) => place(kid.id, depth + 1));
    // Centred over the span of the reports, not over their average: with three
    // reports where the middle one has a wide subtree of its own, the average
    // pulls the manager off the axis of the tree it heads.
    const x = Math.round((centres[0] + centres[centres.length - 1]) / 2);
    auto.set(id, { x, y, depth });
    return x;
  }

  for (const root of roots) place(root.id, 0);

  // Anything the walk missed — only reachable if `resolveParents` and the child
  // map ever disagreed — is parked on its own row rather than dropped. A person
  // who is in the database and not on the chart is the one outcome nobody can
  // debug from the screen.
  for (const person of people) {
    if (auto.has(person.id)) continue;
    auto.set(person.id, { x: nextColumn * (CARD_W + H_GAP), y: 0, depth: 0 });
    nextColumn += 1;
  }

  const nodes: PlacedNode[] = people.map((person) => {
    const slot = auto.get(person.id)!;
    const moved = person.pos_x !== null && person.pos_y !== null;
    return {
      id: person.id,
      x: CANVAS_PAD + (moved ? Math.max(0, person.pos_x!) : slot.x),
      y: CANVAS_PAD + (moved ? Math.max(0, person.pos_y!) : slot.y),
      depth: slot.depth,
      moved,
    };
  });

  const edges: OrgEdge[] = [];
  for (const person of people) {
    const parent = parents.get(person.id) ?? null;
    if (parent && byId.has(parent)) edges.push({ managerId: parent, reportId: person.id });
  }

  const width = Math.max(...nodes.map((n) => n.x + CARD_W)) + CANVAS_PAD;
  const height = Math.max(...nodes.map((n) => n.y + CARD_H)) + CANVAS_PAD;
  return { nodes, edges, width, height };
}

/**
 * The elbow connecting a manager to one report, as an SVG path.
 *
 * Down out of the manager, across at the midpoint, then down into the report —
 * rather than a straight diagonal, which on a wide chart crosses its neighbours
 * and stops being readable. It handles a dragged card too: when the report has
 * been pulled ABOVE its manager the midpoint is behind the start, and the elbow
 * simply runs backwards, which reads correctly as "this line goes up".
 */
export function edgePath(
  manager: { x: number; y: number },
  report: { x: number; y: number },
): string {
  const startX = manager.x + CARD_W / 2;
  const startY = manager.y + CARD_H;
  const endX = report.x + CARD_W / 2;
  const endY = report.y;
  const midY = Math.round((startY + endY) / 2);
  return `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`;
}
