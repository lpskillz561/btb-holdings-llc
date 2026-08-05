/**
 * The deck catalogue — which slides make up which presentation.
 *
 * There is ONE set of slides (`components/present/slides.tsx`) and more than one
 * way through it. A track is an ordering of slide ids, nothing more. That is the
 * whole design, and it is deliberate: the alternative — a second slide module
 * for the short deck — is two files that quote the same money and drift the
 * first time a figure changes. A slide can only appear in a track if it exists
 * in the one place slides are written.
 *
 * Pure data with no React and no `@/lib/crm/presentation` import, so the
 * presentations index can list what a deck contains without building it.
 */

export const DECK_TRACKS = ["first-call", "full"] as const;
export type DeckTrack = (typeof DECK_TRACKS)[number];

/**
 * The bare `/crm/present` URL keeps its old meaning. Someone has that link in a
 * calendar invite or a bookmark, and a URL that quietly starts showing a
 * different deck than it did last week is how a presenter gets surprised on a
 * shared screen. Every entry point in the UI names its track explicitly.
 */
export const DEFAULT_TRACK: DeckTrack = "full";

export function isDeckTrack(value: unknown): value is DeckTrack {
  return typeof value === "string" && (DECK_TRACKS as readonly string[]).includes(value);
}

export function parseTrack(value: unknown): DeckTrack {
  return isDeckTrack(value) ? value : DEFAULT_TRACK;
}

/**
 * `sizedSlide` is the one position that depends on the prospect. With a target
 * deduction on the record the terms slide is *their* number and earns the slot;
 * without one it would show the executed sample, and the tier table says more.
 */
export interface DeckDefinition {
  track: DeckTrack;
  label: string;
  /** One line, shown on the presentations index and the deck's start gate. */
  blurb: string;
  /** Who it is for and when to reach for it. */
  when: string;
  /**
   * Slide ids in presentation order. `"terms|sizes"` resolves to the first when
   * the deck is sized to a client and the second otherwise.
   */
  slides: string[];
}

export const DECKS: Record<DeckTrack, DeckDefinition> = {
  "first-call": {
    track: "first-call",
    label: "First call",
    blurb: "Eight slides. The hook, the asset, the money, the limits, the close.",
    when:
      "A first conversation with a qualified prospect. Leads with the numbers rather than the structure — the doctrine is answered when it is asked, not pre-empted.",
    // The order is the argument. Problem before asset, and the LEVERAGE slide
    // before any doctrine: on the full deck the room sits through six slides of
    // structure and authority before it sees a single figure, which is the
    // pacing complaint that produced this track. The limits slide is never cut
    // — it is what earns the room, and a short deck that drops its own caveats
    // is a worse deck, not a shorter one.
    slides: ["title", "problem", "asset", "leverage", "proforma", "terms|sizes", "limits", "close"],
  },
  full: {
    track: "full",
    label: "Full deck",
    blurb: "Seventeen slides. The whole position, including the structure and the authorities.",
    when:
      "The follow-up call, and the call the CPA joins. Every slide the first-call deck holds back is an answer to a question they will actually ask.",
    slides: [
      "title",
      "who",
      "problem",
      "asset",
      "land",
      "structure",
      "why-structure",
      "tax-case",
      "thirty-days",
      "terms",
      "leverage",
      "proforma",
      "revenue-share",
      "sizes",
      "limits",
      "process",
      "close",
    ],
  },
};

/** Resolve `"terms|sizes"` against whether this deck is sized to a client. */
export function resolveSlideIds(track: DeckTrack, isSized: boolean): string[] {
  return DECKS[track].slides.map((id) => {
    if (!id.includes("|")) return id;
    const [sized, generic] = id.split("|");
    return isSized ? sized : generic;
  });
}
