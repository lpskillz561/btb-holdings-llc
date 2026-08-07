// The CRM's AI layer — the same OpenAI setup the rest of the site uses
// (`OPENAI_API_KEY` / `OPENAI_MODEL`, structured outputs via json_schema),
// pointed at client records instead of parcels.
//
// Every prompt is assembled from four layers, in this order:
//
//   1. BASE_PROMPT below — who the model is and how it writes. Short.
//   2. ./knowledge/SKILL.md — the doctrine: the structure, the authorities, the
//      deal terms, the risks, the hard rules. Transcribed from `docs/`, which is
//      the source of truth and is not in git. See ./skill.ts.
//   3. LEARNED DOCUMENTS — notes the model wrote on files staff uploaded, and
//      that a person then ADOPTED. Reference, explicitly outranked by layer 2.
//      Stored in `crm_documents`; see ./knowledge-docs.ts and `learnedKnowledge`
//      below. This is the only layer that is not in git, which is exactly why
//      the prompt says out loud that it does not govern.
//   4. Record context — the client, proposal, contract or workspace the person
//      is actually looking at, rendered as formatted facts.
//
// The doctrine lives in ONE place on purpose. It used to be inlined here, which
// meant two copies of the tax case that could disagree — and one of them taught
// the 7-day §469 test, so every generated proposal described a deal BTB does not
// sell. Add to SKILL.md, not to a prompt string. Layer 3 is not an exception to
// that rule: a learned note says what some other document says, and the model is
// told not to restate the doctrine in one.
//
// Route new AI surfaces through `buildSystemPrompt` / `buildScopedPrompt` rather
// than writing a bare prompt, or they lose all three layers.
//
// The hard rule, enforced by construction rather than by asking nicely: the
// model never computes money. Figures are calculated in ./economics, frozen
// onto the row, and handed to the model as given facts.

import OpenAI from "openai";
import { fmtAcres, fmtLeverage, fmtMoney, fmtPct } from "./format";
import { query, queryOne } from "./db";
import { clientCostBasis, getCrmSummary, type CostBasis } from "./clients";
import { getBookSummary, listParksWithCapacity } from "./portfolio";
import { loadSkill } from "./skill";
import { site } from "@/lib/site";
import {
  LABELS,
  type CrmClient,
  type CrmContact,
  type CrmContract,
  type CrmProperty,
  type CrmProposal,
  type CrmMeeting,
  type CrmUnit,
} from "./types";

let client: OpenAI | null = null;

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to the web service's environment to enable the CRM's AI features.",
    );
  }
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

/**
 * Who the model is. The doctrine is NOT here — it is in ./knowledge/SKILL.md,
 * which is appended below this and is the single place the tax case, the deal
 * terms and the hard rules are stated. Keep this layer to role and register.
 */
export const BASE_PROMPT = `You are the in-house advisor for ${site.name}'s tiny-home programme. ${site.description}

Everything you say about this business — the structure, the authorities, the deal terms, the figures, what you may and may not draft — is governed by the knowledge base that follows under "HOUSE KNOWLEDGE BASE". Treat it as binding. Where your own general knowledge of "tiny home tax strategies" disagrees with it, the knowledge base is right and you are wrong: it is transcribed from this business's own legal opinion, executed agreements and pro forma. Do not fall back on the generic version of this deal.

You are normally answering a member of ${site.shortName}'s staff, not the client. That means you may be blunt about a weak deal, an unpersuasive record or a figure that will not survive the client's CPA. Say the uncomfortable thing early rather than at the end.`;

/** The layers, assembled. See the module comment. */
async function withKnowledge(context: string): Promise<string> {
  return `${BASE_PROMPT}

---

# HOUSE KNOWLEDGE BASE

${loadSkill()}${await learnedKnowledge()}${context}`;
}

/* -------------------------------------------------------------------------- */
/* Learned documents                                                           */
/*                                                                             */
/* The fourth layer, and the only one that is not in git. Staff upload a PDF or */
/* a Word file, the model writes a note on it, and someone ADOPTS that note —   */
/* see ./knowledge-docs.ts for the storage and the learning, and for why the    */
/* adoption step exists. Everything below is only about what reaches a prompt.  */
/* -------------------------------------------------------------------------- */

/** How much of one note reaches a prompt. A note longer than this is a summary
 *  that failed to summarise, and it is cut with the fact said out loud. */
const MAX_NOTE_CHARS = 8_000;

/**
 * How much learned knowledge reaches a prompt IN TOTAL, across every document.
 *
 * This is the cap that matters. `BASE_PROMPT` + `SKILL.md` + record context is
 * already a substantial system prompt, and the failure this prevents is not cost
 * — it is that an unbounded appendix pushes the house doctrine far enough down
 * the prompt to stop governing the answer. Documents over the line are dropped
 * OLDEST-ADOPTED FIRST, the model is told the count, and the fact is logged: a
 * silent cap produces an assistant that confidently does not know something it
 * was told, which is worse than one that says it cannot see everything.
 */
const MAX_KNOWLEDGE_CHARS = 40_000;

/**
 * The adopted notes, as prompt text.
 *
 * Returns "" when nothing is adopted, which is the normal state and has to stay
 * silent: an empty "LEARNED DOCUMENTS" heading tells the model a section exists
 * and invites it to reason about why it is blank.
 *
 * This is a query on every AI call. It is a partial-index lookup returning a
 * handful of short rows, and it deliberately is NOT cached the way `loadSkill()`
 * is: `SKILL.md` changes on deploy, this changes when someone presses a button,
 * and a process-lifetime cache would mean a document adopted at 10am reaching
 * the model only after the next restart.
 */
export async function learnedKnowledge(): Promise<string> {
  let rows: { id: string; title: string; skill_md: string }[];
  try {
    rows = await query(
      `SELECT id, title, skill_md FROM crm_documents
        WHERE active_at IS NOT NULL AND skill_md IS NOT NULL
        ORDER BY active_at ASC`,
    );
  } catch (err) {
    // Never fatal, unlike a missing SKILL.md. The house knowledge base is what
    // keeps an answer correct about the deal and it is on disk; a database hiccup
    // reading the appendix must not take down every AI surface in the app.
    console.error("[crm/ai] could not load learned documents", err);
    return "";
  }
  if (!rows.length) return "";

  const sections: string[] = [];
  const dropped: string[] = [];
  let budget = MAX_KNOWLEDGE_CHARS;

  for (const row of rows) {
    let note = row.skill_md.trim();
    if (note.length > MAX_NOTE_CHARS) {
      note = `${note.slice(0, MAX_NOTE_CHARS)}\n\n[This note is longer than the space available and is cut off here. Say so if a question turns on a part you cannot see.]`;
    }
    const section = `### ${row.title}\n\n${note}`;
    if (section.length > budget) {
      dropped.push(row.title);
      continue;
    }
    budget -= section.length;
    sections.push(section);
  }

  if (dropped.length) {
    console.warn(
      `[crm/ai] ${dropped.length} adopted document(s) did not fit the prompt budget: ${dropped.join("; ")}`,
    );
  }

  // The precedence paragraph is the load-bearing part of this string. SKILL.md
  // is DOCTRINE — transcribed from this business's own legal opinion and
  // executed agreements — and a learned note is REFERENCE, which is to say what
  // some document that arrived from somewhere else happens to say. Without that
  // stated, a prospect's marketing PDF sits in the same prompt as the memorandum
  // and reads with the same authority, and the model quotes one for the other to
  // a taxpayer's CPA.
  return `

---

# LEARNED DOCUMENTS

The staff have uploaded the documents below and adopted your notes on them. Treat them as REFERENCE, not as doctrine.

The HOUSE KNOWLEDGE BASE above outranks everything here. It is transcribed from this business's own legal opinion, executed agreements and pro forma; these are documents that came from somewhere else. Where a note below disagrees with the house knowledge base, the house knowledge base is what BTB does — and the disagreement is itself worth saying out loud rather than smoothing over.

Attribute what you take from these. "The Aragona opinion says…", not "the rule is…". A reader must always be able to tell which document an answer came from.${
    dropped.length
      ? `\n\n${dropped.length} further adopted document(s) did not fit here and you have not been shown them. If a question seems to be about a document you cannot see, say so rather than answering from the others.`
      : ""
  }

${sections.join("\n\n")}`;
}

/**
 * The full text of specific documents, for a question plainly about one.
 *
 * A DIFFERENT thing from `learnedKnowledge()`, and the distinction is the point.
 * That one is standing knowledge, adopted deliberately, in every prompt on every
 * surface. This is a transient read of a document someone has just put in front
 * of the assistant in a chat message: scoped to that conversation, gone when the
 * message scrolls out of context, and available whether or not the document has
 * been adopted.
 *
 * Adopting is "learn this permanently, for everyone". Pasting one into the room
 * and asking about it is "read this now". Requiring the first before the second
 * would make the feature useless for the thing people actually do, which is drop
 * a PDF in the chat and ask what it says.
 */
export async function documentReadingContext(ids: string[], budget = 60_000): Promise<string> {
  if (!ids.length) return "";
  let rows: { id: string; title: string; text_body: string | null; status: string }[];
  try {
    rows = await query(`SELECT id, title, text_body, status FROM crm_documents WHERE id = ANY($1)`, [
      ids,
    ]);
  } catch (err) {
    console.error("[crm/ai] could not load documents for reading", err);
    return "";
  }

  const sections: string[] = [];
  let left = budget;
  for (const row of rows) {
    const text = row.text_body?.trim();
    if (!text) {
      // Named anyway. The model is about to be asked about a document that is
      // attached to the message it is answering, and "I have not been given
      // that" is a far better answer than one improvised from a file name.
      sections.push(
        `### ${row.title}\nThis document is attached to the conversation but its text is not available to you (${
          row.status === "failed" ? "it could not be read" : "it has not been read yet"
        }). Do not guess at what it says.`,
      );
      continue;
    }
    if (left <= 0) break;
    const slice =
      text.length > left
        ? `${text.slice(0, left)}\n\n[cut off here — the document is longer than the space available]`
        : text;
    sections.push(`### ${row.title}\n\n${slice}`);
    left -= slice.length;
  }
  if (!sections.length) return "";

  return `

---

# DOCUMENTS IN THIS CONVERSATION

Someone has attached these to the messages you are answering. This is their actual text, not a summary of it. Work from it, quote it exactly where that helps, and attribute what you take from it by title.

${sections.join("\n\n")}`;
}

/* -------------------------------------------------------------------------- */
/* Client context                                                              */
/* -------------------------------------------------------------------------- */

function describeClient(c: CrmClient): string {
  const lines = [
    `Name: ${c.name}`,
    c.legal_name && `Legal / entity name: ${c.legal_name}`,
    `Filing entity: ${LABELS.entityType[c.entity_type]}`,
    `Pipeline stage: ${LABELS.clientStatus[c.status]}`,
    c.state && `Based in: ${[c.city, c.state].filter(Boolean).join(", ")}`,
    c.tax_state && `Files in: ${c.tax_state}`,
    c.marginal_rate_bps != null &&
      `Assumed marginal rate: ${fmtPct(c.marginal_rate_bps)}`,
    c.est_annual_income_cents != null &&
      `Estimated annual income: ${fmtMoney(c.est_annual_income_cents)}`,
    c.target_writeoff_cents != null &&
      `Deduction they are trying to achieve: ${fmtMoney(c.target_writeoff_cents)}`,
    c.investment_capacity_cents != null &&
      `Capital they have indicated: ${fmtMoney(c.investment_capacity_cents)}`,
    c.cpa_name && `CPA: ${c.cpa_name}`,
    c.notes && `Notes from the relationship owner: ${c.notes}`,
  ].filter(Boolean);
  return `## Client\n${lines.join("\n")}`;
}

function describeLandCriteria(c: CrmClient): string {
  const bits = [
    c.target_state && `state: ${c.target_state}`,
    c.target_county && `county: ${c.target_county}`,
    (c.target_min_acres != null || c.target_max_acres != null) &&
      `lot size: ${fmtAcres(c.target_min_acres)}–${fmtAcres(c.target_max_acres)}`,
    c.target_max_price_cents != null && `budget: up to ${fmtMoney(c.target_max_price_cents)}`,
  ].filter(Boolean);
  if (!bits.length) return "";
  return `## Land criteria on file\n${bits.join(", ")}`;
}

function describeHoldings(properties: CrmProperty[], units: CrmUnit[]): string {
  if (!properties.length && !units.length) {
    return `## Holdings\nNothing recorded yet — this client owns no land or units through Ziora so far.`;
  }
  const land = properties.map((p) => {
    const where = [p.address, p.city, p.county && `${p.county} County`, p.state, p.postal_code]
      .filter(Boolean)
      .join(", ");
    return (
      `- Land: ${p.label} [${LABELS.propertyStatus[p.status]}]` +
      `${where ? ` — ${where}` : ""}` +
      `${p.acres != null ? `, ${fmtAcres(p.acres)}` : ""}` +
      `${p.purchase_price_cents != null ? `, bought for ${fmtMoney(p.purchase_price_cents)}` : ""}` +
      `${p.closing_costs_cents ? `, closing ${fmtMoney(p.closing_costs_cents)}` : ""}` +
      `${p.improvements_cents ? `, land improvements ${fmtMoney(p.improvements_cents)}` : ""}`
    );
  });
  const homes = units.map((u) => {
    const allIn =
      (u.purchase_price_cents ?? 0) + (u.site_work_cents ?? 0) + (u.soft_costs_cents ?? 0);
    return (
      `- Unit: ${u.label} [${LABELS.unitStatus[u.status]}, ${LABELS.unitUse[u.unit_use]}]` +
      `${u.model ? `, ${u.manufacturer ?? ""} ${u.model}`.trimEnd() : ""}` +
      `${u.purchase_price_cents != null ? `, unit ${fmtMoney(u.purchase_price_cents)}` : ""}` +
      `${u.site_work_cents ? `, site work ${fmtMoney(u.site_work_cents)}` : ""}` +
      `${u.soft_costs_cents ? `, soft costs ${fmtMoney(u.soft_costs_cents)}` : ""}` +
      `${allIn > 0 ? `, all-in ${fmtMoney(allIn)}` : ""}` +
      `${u.placed_in_service_on ? `, placed in service ${u.placed_in_service_on}` : ", NOT yet placed in service"}` +
      `${u.monthly_rent_cents ? `, rents at ${fmtMoney(u.monthly_rent_cents)}/mo` : ""}` +
      `${u.sold_on ? `, SOLD ${u.sold_on}${u.sale_price_cents ? ` for ${fmtMoney(u.sale_price_cents)}` : ""}` : ""}`
    );
  });
  return `## Holdings\n${[...land, ...homes].join("\n")}`;
}

/** What the programme has cost this client so far. */
function describeCostPosition(cost: CostBasis): string {
  if (cost.property_count === 0 && cost.unit_count === 0) return "";
  return [
    `## What this client has spent (asset cost, NOT cash movements)`,
    `- All-in capital: ${fmtMoney(cost.total_capital_cents)}`,
    `- Land basis (not depreciable): ${fmtMoney(cost.land_basis_cents)}`,
    `- Depreciable basis: ${fmtMoney(cost.depreciable_basis_cents)}`,
    `- Of that, placed in service: ${fmtMoney(cost.in_service_basis_cents)} (${cost.in_service_count} of ${cost.unit_count} units)`,
    cost.bonus_claimed_cents > 0 && `- Bonus depreciation recorded as claimed: ${fmtMoney(cost.bonus_claimed_cents)}`,
    cost.annual_property_tax_cents > 0 && `- Annual property tax: ${fmtMoney(cost.annual_property_tax_cents)}`,
    cost.personal_use_count > 0 &&
      `- ${cost.personal_use_count} unit(s) are personal use and excluded from the depreciable basis.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function describeHistory(
  proposals: CrmProposal[],
  contracts: CrmContract[],
  contacts: CrmContact[],
): string {
  const sections: string[] = [];
  if (proposals.length) {
    const lines = proposals
      .slice(0, 6)
      .map(
        (p) =>
          `- "${p.title}" [${LABELS.proposalStatus[p.status]}] — ${p.unit_count} unit(s), ` +
          `${fmtMoney(p.total_investment_cents)} invested, ` +
          `${fmtMoney(p.year_one_deduction_cents)} year-one deduction`,
      );
    sections.push(`## Proposals already sent\n${lines.join("\n")}`);
  }
  if (contracts.length) {
    // Grouped by deal_group_id in the caller's ORDER BY, so a generated set of
    // three reads as three lines together. Whether a set is COMPLETE matters:
    // Purchase, Finance and Management are cross-referenced and one alone is
    // not executable.
    const lines = contracts.map(
      (k) =>
        `- "${k.title}" [${LABELS.contractType[k.type]}, ${LABELS.contractStatus[k.status]}] — ` +
        `${fmtMoney(k.value_cents)}` +
        `${k.signed_at ? `, signed ${k.signed_at}` : ", NOT SIGNED"}` +
        `${k.effective_date ? `, effective ${k.effective_date}` : ""}` +
        `${k.monthly_payment_cents != null ? `, note ${fmtMoney(k.monthly_payment_cents)}/month` : ""}` +
        `${k.deal_group_id ? ` (set ${k.deal_group_id.slice(0, 8)})` : ""}`,
    );
    sections.push(`## Contracts on this account\n${lines.join("\n")}`);
  }
  if (contacts.length) {
    const lines = contacts.map(
      (c) =>
        `- ${c.name} (${LABELS.contactRole[c.role]})${c.title ? `, ${c.title}` : ""}`,
    );
    sections.push(`## People on the account\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}

/**
 * What was said on the calls, as opposed to what is on the record.
 *
 * The SUMMARIES only — never the transcripts, even when CRM_STORE_TRANSCRIPTS is
 * on. A verbatim transcript would crowd out the rest of this context on length
 * alone, and it is the most sensitive text in the database; the summary is
 * already the distilled version and it is what the advisor actually needs.
 *
 * This is the piece the advisor was missing. It knew the client's proposals,
 * contracts and units, and nothing at all about what anyone had promised them.
 */
function describeMeetings(meetings: CrmMeeting[]): string {
  const summarised = meetings.filter((m) => m.summary_md?.trim());
  if (!summarised.length) {
    // Say so explicitly. Silence here reads to the model as "no calls have
    // happened", which is a different and wrong claim from "none are summarised".
    return meetings.length
      ? `## Calls\n${meetings.length} call(s) are on this account, none of them summarised yet. Do not assume what was said on them.`
      : "";
  }
  const lines = summarised.slice(0, 4).map((m) => {
    const when = m.occurred_at.slice(0, 10);
    // Trimmed: four summaries at full length would dominate the context.
    const body = m.summary_md!.trim().slice(0, 2500);
    return `### ${when} — ${m.title}\n${body}`;
  });
  return `## What was said on recent calls\nThese are AI summaries of recorded calls, not transcripts and not a record anyone has signed. Where a summary and the frozen figures on a proposal disagree, the proposal is what was actually quoted.\n\n${lines.join("\n\n")}`;
}

/** Everything the model should know about one client, as prompt text. */
export async function buildClientContext(clientId: string): Promise<string> {
  const client = await queryOne<CrmClient>(`SELECT * FROM crm_clients WHERE id = $1`, [clientId]);
  if (!client) return "";

  // Archived rows are excluded here for the same reason they leave every list
  // and every total: a withdrawn proposal is not part of what this account is,
  // and an advisor that reasons from one is reasoning about a deal nobody is
  // doing. The row is still there; it is just not context.
  const [contacts, properties, units, proposals, contracts, meetings, cost] = await Promise.all([
    query<CrmContact>(`SELECT * FROM crm_contacts WHERE client_id = $1 ORDER BY created_at`, [
      clientId,
    ]),
    query<CrmProperty>(`SELECT * FROM crm_properties WHERE client_id = $1 ORDER BY created_at`, [
      clientId,
    ]),
    query<CrmUnit>(`SELECT * FROM crm_units WHERE client_id = $1 ORDER BY created_at`, [clientId]),
    query<CrmProposal>(
      `SELECT * FROM crm_proposals WHERE client_id = $1 AND archived_at IS NULL
       ORDER BY created_at DESC LIMIT 6`,
      [clientId],
    ),
    query<CrmContract>(
      `SELECT * FROM crm_contracts WHERE client_id = $1 AND archived_at IS NULL
       ORDER BY deal_group_id NULLS LAST, created_at DESC LIMIT 12`,
      [clientId],
    ),
    // Summaries only — the transcript column is not selected here at all, so a
    // long call cannot silently blow out this prompt. See describeMeetings.
    query<CrmMeeting>(
      `SELECT id, client_id, title, status, platform, source, occurred_at,
              summary_md, summary_model, summarized_at
       FROM crm_meetings WHERE client_id = $1
       ORDER BY occurred_at DESC LIMIT 8`,
      [clientId],
    ),
    clientCostBasis(clientId),
  ]);

  const sections = [
    describeClient(client),
    describeLandCriteria(client),
    describeHoldings(properties, units),
    describeCostPosition(cost),
    describeHistory(proposals, contracts, contacts),
    describeMeetings(meetings),
  ].filter(Boolean);

  return `\n\n---\n\nContext for this client:\n\n${sections.join("\n\n")}`;
}

/* -------------------------------------------------------------------------- */
/* Workspace, proposal and contract context                                    */
/* -------------------------------------------------------------------------- */

/**
 * The whole book, for a question that no single record can answer — "which
 * contracts are unsigned", "how much capacity is left", "what is the pipeline
 * worth". This is what the assistant gets on a list page.
 *
 * Every figure here is aggregated in SQL and formatted before the model sees it,
 * for the same reason proposal economics are frozen: the model reports, it never
 * computes. Note the money aggregates in ./portfolio and ./clients are cast
 * ::bigint — sum(bigint) is NUMERIC and arrives as a string otherwise.
 */
export async function buildWorkspaceContext(): Promise<string> {
  const [summary, book, parks, proposals, contracts] = await Promise.all([
    getCrmSummary(),
    getBookSummary(),
    listParksWithCapacity(),
    query<CrmProposal & { client_name: string }>(
      `SELECT p.*, c.name AS client_name FROM crm_proposals p
       JOIN crm_clients c ON c.id = p.client_id
       WHERE p.archived_at IS NULL ORDER BY p.updated_at DESC LIMIT 12`,
    ),
    query<CrmContract & { client_name: string }>(
      `SELECT k.*, c.name AS client_name FROM crm_contracts k
       JOIN crm_clients c ON c.id = k.client_id
       WHERE k.archived_at IS NULL ORDER BY k.updated_at DESC LIMIT 12`,
    ),
  ]);

  const pipeline = Object.entries(summary.by_status)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${LABELS.clientStatus[status as keyof typeof LABELS.clientStatus]}: ${n}`)
    .join(", ");

  const sections = [
    [
      `## The book right now`,
      `- Clients: ${summary.clients_total}${pipeline ? ` (${pipeline})` : ""}`,
      `- Open proposals (draft or sent): ${fmtMoney(summary.open_proposal_value_cents)}`,
      `- Accepted proposals: ${fmtMoney(summary.accepted_proposal_value_cents)}`,
      `- Signed or active contracts: ${fmtMoney(summary.active_contract_value_cents)}`,
      `- Deduction delivered on accepted proposals: ${fmtMoney(summary.writeoff_delivered_cents)}`,
      `- Units: ${summary.units_in_service} in service of ${summary.units_total}`,
      `- Cash: ${fmtMoney(summary.finance.income_cents)} received, ${fmtMoney(summary.finance.expense_cents)} paid out, ` +
        `${fmtMoney(summary.finance.outstanding_cents)} outstanding, ` +
        `${fmtMoney(summary.finance.annual_rent_run_rate_cents)} annual rent run rate`,
      `(Asset cost and cash movement are different things and are never added together.)`,
    ].join("\n"),

    [
      `## BTB's own land and capacity`,
      `- Parks: ${book.parks}, ${fmtAcres(book.acres)}`,
      `- Pads: ${book.pads_total} total — ${book.pads_occupied} occupied, ${book.pads_available} available, ${book.pads_pipeline} planned or building`,
      `- Homes on BTB's own book (no client): ${book.btb_units} (${book.btb_units_in_service} in service)`,
      `- Client-owned homes on BTB pads: ${book.client_units} (${book.client_units_in_service} in service)`,
      `- Land basis (never depreciable, INTERNAL — never quote to a client): ${fmtMoney(book.land_basis_cents)}`,
    ].join("\n"),

    parks.length
      ? `## Parks\n${parks
          .slice(0, 20)
          .map(
            (p) =>
              `- ${p.name} [${LABELS.parkStatus[p.status]}]` +
              `${p.state ? ` — ${[p.city, p.state].filter(Boolean).join(", ")}` : ""}` +
              `, ${p.available_pads} of ${p.pad_count} pads available` +
              `${p.sections_remaining != null ? `, ${p.sections_remaining} section(s) of stated capacity still sellable` : ""}`,
          )
          .join("\n")}`
      : "",

    proposals.length
      ? `## Recent proposals (archived rows excluded)\n${proposals
          .map(
            (p) =>
              `- ${p.client_name} — "${p.title}" [${LABELS.proposalStatus[p.status]}], ` +
              `${p.unit_count} unit(s), ${fmtMoney(p.total_investment_cents)} invested, ` +
              `${fmtMoney(p.year_one_deduction_cents)} year-one deduction, ` +
              `${fmtMoney(p.cash_invested_cents)} cash in`,
          )
          .join("\n")}`
      : "",

    contracts.length
      ? `## Recent contracts (archived rows excluded)\n${contracts
          .map(
            (k) =>
              `- ${k.client_name} — "${k.title}" [${LABELS.contractType[k.type]}, ${LABELS.contractStatus[k.status]}], ` +
              `${fmtMoney(k.value_cents)}` +
              `${k.signed_at ? `, signed ${k.signed_at}` : ", UNSIGNED"}` +
              `${k.deal_group_id ? `, part of generated set ${k.deal_group_id.slice(0, 8)}` : ""}`,
          )
          .join("\n")}`
      : "",
  ].filter(Boolean);

  return `\n\n---\n\nContext for the whole workspace:\n\n${sections.join("\n\n")}`;
}

/** One proposal, with the client it belongs to. Every figure is frozen on the row. */
export async function buildProposalContext(proposalId: string): Promise<string> {
  const proposal = await queryOne<CrmProposal>(`SELECT * FROM crm_proposals WHERE id = $1`, [
    proposalId,
  ]);
  if (!proposal) return "";

  const lines = [
    `## The proposal on screen`,
    `Title: ${proposal.title}`,
    `Status: ${LABELS.proposalStatus[proposal.status]}${proposal.archived_at ? " — ARCHIVED" : ""}`,
    `Units: ${proposal.unit_count}`,
    `Total investment: ${fmtMoney(proposal.total_investment_cents)}`,
    `Depreciable basis: ${fmtMoney(proposal.depreciable_basis_cents)}`,
    `Year-one deduction: ${fmtMoney(proposal.year_one_deduction_cents)}`,
    `Year-one tax saving at ${fmtPct(proposal.marginal_rate_bps)}: ${fmtMoney(proposal.year_one_tax_savings_cents)}`,
    `Cash invested (the deposit): ${fmtMoney(proposal.cash_invested_cents)}`,
    `Seller-financed: ${fmtMoney(proposal.financed_cents)} at ${fmtMoney(proposal.monthly_note_cents)}/month`,
    `Annual debt service: ${fmtMoney(proposal.annual_debt_service_cents)}`,
    `Net year-one outlay: ${fmtMoney(proposal.net_year_one_outlay_cents)} (a negative figure means ahead in year one)`,
    proposal.deduction_leverage_bps != null &&
      `Deduction per dollar of cash: ${fmtLeverage(proposal.deduction_leverage_bps)}`,
    `Annual NOI: ${fmtMoney(proposal.annual_noi_cents)}; annual cash flow: ${fmtMoney(proposal.annual_cash_flow_cents)}`,
    `Occupancy assumed: ${fmtPct(proposal.occupancy_bps)}; operating expenses: ${fmtPct(proposal.opex_bps)}`,
    proposal.valid_until && `Valid until: ${proposal.valid_until}`,
    ``,
    `These figures were computed in lib/crm/economics.ts and frozen on the row when the`,
    `proposal was created. They are given facts. Do not recompute, reconcile or adjust them.`,
  ].filter(Boolean);

  return `\n\n---\n\n${lines.join("\n")}${await buildClientContext(proposal.client_id)}`;
}

/** One contract, with its sibling documents and the client it belongs to. */
export async function buildContractContext(contractId: string): Promise<string> {
  const contract = await queryOne<CrmContract>(`SELECT * FROM crm_contracts WHERE id = $1`, [
    contractId,
  ]);
  if (!contract) return "";

  // The execution set is one deal. A contract shown alone reads as complete when
  // it is not — Purchase, Finance and Management are cross-referenced.
  const siblings = contract.deal_group_id
    ? await query<CrmContract>(
        `SELECT * FROM crm_contracts WHERE deal_group_id = $1 AND id <> $2 ORDER BY type`,
        [contract.deal_group_id, contract.id],
      )
    : [];

  const lines = [
    `## The contract on screen`,
    `Title: ${contract.title}`,
    `Type: ${LABELS.contractType[contract.type]}`,
    `Status: ${LABELS.contractStatus[contract.status]}${contract.archived_at ? " — ARCHIVED" : ""}`,
    `Value: ${fmtMoney(contract.value_cents)}`,
    contract.counterparty && `Counterparty: ${contract.counterparty}`,
    contract.effective_date && `Effective: ${contract.effective_date}`,
    contract.signed_at ? `Signed: ${contract.signed_at}` : `NOT YET SIGNED`,
    contract.buyer_legal_name && `Buyer of record: ${contract.buyer_legal_name}`,
    contract.trust_name && `Trust: ${contract.trust_name}`,
    contract.unit_vin && `Unit VIN: ${contract.unit_vin}`,
    contract.purchase_price_cents != null &&
      `Purchase price: ${fmtMoney(contract.purchase_price_cents)}`,
    contract.down_payment_cents != null &&
      `Down payment: ${fmtMoney(contract.down_payment_cents)}`,
    contract.financed_cents != null && `Financed: ${fmtMoney(contract.financed_cents)}`,
    contract.note_rate_bps != null &&
      contract.note_term_months != null &&
      `Note: ${fmtPct(contract.note_rate_bps)} over ${contract.note_term_months} monthly payments`,
    contract.monthly_payment_cents != null &&
      `Monthly payment: ${fmtMoney(contract.monthly_payment_cents)}`,
    contract.revenue_split_bps != null &&
      `Revenue split to the Owner, after operating expenses: ${fmtPct(contract.revenue_split_bps)}`,
    siblings.length
      ? `Other documents in this execution set: ${siblings
          .map((s) => `${LABELS.contractType[s.type]} [${LABELS.contractStatus[s.status]}]`)
          .join("; ")}`
      : contract.deal_group_id
        ? `This is the only document in its set, which should not happen — the three are generated together.`
        : `Not part of a generated set.`,
    ``,
    `These terms are frozen on the row. You may explain what a clause means and you may`,
    `draft a cover letter. You may NOT draft, reword or "tidy" a term — the legal text is a`,
    `template in lib/crm/contract-templates.ts, and rephrasing a clause changes the deal.`,
  ].filter(Boolean);

  return `\n\n---\n\n${lines.join("\n")}${await buildClientContext(contract.client_id)}`;
}

/* -------------------------------------------------------------------------- */
/* Prompt assembly                                                             */
/* -------------------------------------------------------------------------- */

/** What the person asking is looking at. Drives which record context is loaded. */
export type PromptScope =
  | { type: "global" }
  | { type: "client"; id: string }
  | { type: "proposal"; id: string }
  | { type: "contract"; id: string };

async function contextFor(scope: PromptScope): Promise<string> {
  switch (scope.type) {
    case "client":
      return buildClientContext(scope.id);
    case "proposal":
      return buildProposalContext(scope.id);
    case "contract":
      return buildContractContext(scope.id);
    case "global":
      return buildWorkspaceContext();
  }
}

/**
 * Base prompt + house knowledge + whatever the person is looking at.
 *
 * A record context that fails to load is not fatal — the knowledge base is what
 * keeps an answer correct about the deal, and a question about the programme
 * itself deserves an answer even if one query is unhappy. A MISSING knowledge
 * base is fatal, by design; see ./skill.ts.
 */
export async function buildScopedPrompt(scope: PromptScope): Promise<string> {
  let context = "";
  try {
    context = await contextFor(scope);
  } catch (err) {
    console.error(`[crm/ai] ${scope.type} context failed to load`, err);
    context = `\n\n---\n\nThe record context for this ${scope.type} could not be loaded. Say so if the question depends on it rather than answering from memory.`;
  }
  return await withKnowledge(context);
}

/**
 * The client-or-nothing form the existing surfaces use (proposal drafting,
 * land-fit scoring). Passing no client gives the knowledge base with no record
 * context, which is what land scoring wants when it is not scoped to anyone.
 */
export async function buildSystemPrompt(clientId?: string | null): Promise<string> {
  if (!clientId) return await withKnowledge("");
  return buildScopedPrompt({ type: "client", id: clientId });
}

/* -------------------------------------------------------------------------- */
/* Structured completion                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One structured-output call. Throws if the model returns nothing parseable.
 *
 * No `temperature` is sent, deliberately. Newer models reject any value other
 * than the default and fail the whole request with a 400 — which is exactly how
 * every CRM AI feature broke on first deploy against `gpt-5.5`. The site's
 * existing assess.ts omits it for the same reason, and the JSON schema already
 * constrains the shape of the output far more than a temperature would.
 */
export async function structuredChat<T>(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  schema: { name: string; schema: Record<string, unknown>; strict?: boolean },
): Promise<T> {
  const res = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages,
    response_format: { type: "json_schema", json_schema: schema },
  });
  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error("The AI returned an empty response.");
  return JSON.parse(raw) as T;
}
