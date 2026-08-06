// Inline AI assistance, for the surfaces that are NOT a conversation.
//
// `./advisor` answers questions. This answers a different one: "help me fill
// this in". It backs the sparkle control on the client form, the record
// dialogs, the notes fields, the kanban board and the client list.
//
// Three rules govern every function here, and all three are structural rather
// than requests made politely in a prompt:
//
// 1. NOTHING HERE WRITES. Every function returns a suggestion and stops. The
//    human presses "Use", and the value then travels the ordinary POST/PATCH
//    path with its ordinary allow-list in ./resource. There is deliberately no
//    code path from a model completion to an UPDATE — the whole point of a
//    propose-then-confirm design is that the model's output is reviewed by
//    someone before it is a fact about a taxpayer.
//
// 2. THE MODEL NEVER COMPUTES MONEY. `NEVER_SUGGEST` below is the enforcement:
//    the frozen economics on a proposal, the deal terms on a contract and the
//    provenance-stamped AI artifacts are stripped from the model's output
//    server-side, after generation, so a prompt that fails to obey still cannot
//    put a computed figure in front of anyone. ./economics and ./deal are the
//    only things that produce those numbers.
//
// 3. EVERY CALL INHERITS THE HOUSE KNOWLEDGE. Prompts are assembled by
//    `buildScopedPrompt` in ./ai, so BASE_PROMPT + knowledge/SKILL.md + the
//    record context are all present. A suggestion written without SKILL.md is
//    a suggestion about the generic "tiny home tax strategy" — the 7-day test,
//    a non-recourse note, land the client owns — which is a deal BTB does not
//    sell. Never call the model directly from here.

import { CrmError } from "./db";
import { buildScopedPrompt, isAiConfigured, structuredChat } from "./ai";
import { listClients } from "./clients";
import { listTodos } from "./todos";
import { fmtMoney } from "./format";
import { LABELS, TODO_STATUSES } from "./types";
import type { PromptScope } from "./ai";

/* -------------------------------------------------------------------------- */
/* The guardrail                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Columns a suggestion may never carry, whatever the model returns.
 *
 * Two groups, for two different reasons:
 *
 * - **Computed and frozen.** Proposal economics come from ./economics and the
 *   note terms from ./deal, and both are frozen onto the row at creation
 *   precisely so a proposal and the contract it becomes cannot disagree. They
 *   are also absent from the PATCH allow-list in ./resource, so a suggestion
 *   here would be un-appliable anyway — but it would still have been *shown*,
 *   and a plausible wrong figure on screen is the hazard.
 *
 * - **AI artifacts with a stamp beside them.** `summary_md` records what the
 *   model said and `summary_model` says which model said it. A hand-edited — or
 *   a second-model-edited — summary makes that stamp a lie.
 */
const NEVER_SUGGEST = new Set([
  // Proposal economics — lib/crm/economics.ts owns these.
  "total_investment_cents",
  "depreciable_basis_cents",
  "year_one_deduction_cents",
  "year_one_tax_savings_cents",
  "cash_invested_cents",
  "financed_cents",
  "monthly_note_cents",
  "annual_debt_service_cents",
  "net_year_one_outlay_cents",
  "deduction_leverage_bps",
  "annual_noi_cents",
  "annual_cash_flow_cents",
  "occupancy_bps",
  "opex_bps",
  // Contract deal terms — lib/crm/deal.ts owns these. 0%, 720 months and the
  // 50/50 split are constants because the memorandum's economic-substance
  // reasoning is built on that shape.
  "purchase_price_cents",
  "down_payment_cents",
  "note_rate_bps",
  "note_term_months",
  "monthly_payment_cents",
  "revenue_split_bps",
  "not_for_execution",
  "config_issues",
  // Provenance-stamped artifacts.
  "summary_md",
  "summary_model",
  "summarized_at",
  "area_analysis",
]);

function assertConfigured(): void {
  if (!isAiConfigured()) {
    throw new CrmError(
      "AI assistance is unavailable: OPENAI_API_KEY is not set on the web service.",
      503,
    );
  }
}

/**
 * The register every one of these calls is written in.
 *
 * Appended after the knowledge base rather than replacing it. The emphasis on
 * leaving things blank is deliberate and is the main thing that makes the
 * feature usable: a suggestion engine that fills every box with something
 * plausible turns a client record into fiction, and the person reviewing it has
 * no way to tell the invented fields from the observed ones.
 */
const ASSIST_REGISTER = `You are filling in an internal CRM for a member of staff who will review every suggestion before it is saved. You are not writing to the client.

Rules, in order of importance:

1. Suggest a value ONLY where the record, the call summaries or the notes actually support it. If nothing supports a field, OMIT it. Returning six well-sourced suggestions and leaving nine fields alone is a good answer; returning fifteen plausible guesses is a bad one, because the person reviewing cannot tell which is which.
2. Never invent a person, a firm, an email address, a phone number, a date or a dollar figure. If a CPA has not been named anywhere, there is no CPA.
3. Every suggestion carries a \`reason\` that says WHERE it came from — "the 12 March call summary says they file in Texas", "their notes name Halloran & Co". "Seems likely" is not a reason and means you should have omitted the field.
4. Money and rates are the ones to be most careful about. Suggest them only when a figure was actually stated somewhere, quote it in \`reason\`, and mark confidence "low" unless it was stated plainly. You never calculate a figure — the economics are computed in code and frozen on the record.
5. Match the form's own units. A percent field takes whole percents (37, not 0.37, not 3700). A money field takes whole dollars with no symbol, commas or decimals (1250000). A select takes one of the option values given, verbatim.`;

/* -------------------------------------------------------------------------- */
/* Kind: fields — "help me fill this in"                                       */
/* -------------------------------------------------------------------------- */

export interface AssistField {
  name: string;
  label: string;
  type: string;
  options?: readonly string[];
  hint?: string;
}

export interface FieldSuggestion {
  field: string;
  /** Exactly what to put in the input, in the FORM's units. */
  value: string;
  /** How to show it to a human before they accept it. */
  display: string;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export interface FieldsResult {
  suggestions: FieldSuggestion[];
  /** What the model would need in order to do better. Shown as prompts to ask. */
  questions: string[];
  /** Contradictions worth surfacing — the "Points to check" idea, inline. */
  warnings: string[];
}

const FIELDS_SCHEMA = {
  name: "field_suggestions",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["suggestions", "questions", "warnings"],
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field", "value", "display", "reason", "confidence"],
          properties: {
            field: { type: "string", description: "The field's `name`, verbatim." },
            value: { type: "string", description: "The value to place in the input, in the form's units." },
            display: { type: "string", description: "The same value, formatted for a human to read." },
            reason: { type: "string", description: "Where in the record this came from." },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
        },
      },
      questions: { type: "array", items: { type: "string" } },
      warnings: { type: "array", items: { type: "string" } },
    },
  },
} as const;

/**
 * Propose values for the fields of one form.
 *
 * `fields` is supplied by the caller because the form spec lives in the browser
 * (see components/crm/RecordForm.tsx). It is not trusted: the result is filtered
 * back down to the names that were asked for, minus `NEVER_SUGGEST`, so a
 * tampered request still cannot make this emit a frozen economics column.
 */
export async function suggestFields(args: {
  scope: PromptScope;
  fields: AssistField[];
  /** What is already typed. Keys are field names. */
  current?: Record<string, string>;
  /** The form's own name, so the model knows what it is filling in. */
  formTitle?: string;
  /** Free text from the person, e.g. pasted notes from a call. */
  hint?: string;
}): Promise<FieldsResult> {
  assertConfigured();

  const askable = args.fields.filter((f) => !NEVER_SUGGEST.has(f.name));
  if (!askable.length) {
    // Every field on this form is computed or frozen. That is a correct outcome
    // for a proposal's economics panel, not an error.
    return { suggestions: [], questions: [], warnings: [] };
  }

  const current = args.current ?? {};
  const describeField = (f: AssistField) => {
    const filled = current[f.name]?.trim();
    return [
      `- \`${f.name}\` — ${f.label} (${f.type})`,
      f.options?.length ? ` | one of: ${f.options.join(", ")}` : "",
      f.hint ? ` | ${f.hint}` : "",
      filled ? ` | ALREADY FILLED IN: "${filled}"` : " | empty",
    ].join("");
  };

  const system = await buildScopedPrompt(args.scope);
  const result = await structuredChat<FieldsResult>(
    [
      { role: "system", content: `${system}\n\n---\n\n${ASSIST_REGISTER}` },
      {
        role: "user",
        content: [
          `Help fill in this form${args.formTitle ? `: ${args.formTitle}` : ""}.`,
          ``,
          `## The fields`,
          askable.map(describeField).join("\n"),
          ``,
          `A field marked ALREADY FILLED IN has a value a person typed. Suggest a replacement ONLY if the record plainly contradicts it, and say so in \`reason\`. Otherwise leave it alone.`,
          args.hint?.trim()
            ? `\n## What the person adding this said\n${args.hint.trim()}\n\nTreat this as the strongest available source — it is what they are looking at right now.`
            : "",
          ``,
          `In \`warnings\`, note anything in the record that contradicts itself or contradicts the programme's own documents — a figure quoted without §461(l), a 7-day test described where the 30-day one applies, a deposit that disagrees with a frozen proposal. Leave it empty if there is nothing.`,
          `In \`questions\`, put at most three things you would need answered to fill in the rest.`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    FIELDS_SCHEMA,
  );

  const allowed = new Set(askable.map((f) => f.name));
  const byName = new Map(askable.map((f) => [f.name, f]));

  return {
    // Filtered against what was actually asked for. This is the guarantee, not
    // the prompt: a model that returns `year_one_deduction_cents` anyway has it
    // dropped here rather than shown to someone.
    suggestions: (result.suggestions ?? [])
      .filter((s) => s && allowed.has(s.field) && String(s.value ?? "").trim())
      .filter((s) => {
        // A select may only be set to one of its own options. An invented enum
        // value would fail the CHECK constraint at save time with a 400 that
        // reads as a bug in the form.
        const spec = byName.get(s.field);
        if (!spec?.options?.length) return true;
        return spec.options.includes(s.value);
      })
      .slice(0, 24),
    questions: (result.questions ?? []).slice(0, 3),
    warnings: (result.warnings ?? []).slice(0, 4),
  };
}

/* -------------------------------------------------------------------------- */
/* Kind: text — the notes fields                                               */
/* -------------------------------------------------------------------------- */

export const TEXT_ACTIONS = ["tidy", "brief", "expand", "actions", "check"] as const;
export type TextAction = (typeof TEXT_ACTIONS)[number];

const TEXT_BRIEFS: Record<TextAction, string> = {
  tidy: "Rewrite this so it reads as clean internal notes: full sentences, no filler, names and figures preserved EXACTLY as written. Do not add anything that is not already there.",
  brief:
    "Compress this to its essentials — the decisions, the figures, the commitments and who owns the next step. Losing detail is fine; changing a figure or a name is not.",
  expand:
    "Turn this shorthand into notes a colleague could pick up cold. You may add structure, headings and connective prose. You may NOT add facts: anything you are unsure of goes in `note` as a question, not into the text.",
  actions:
    "Extract the concrete next actions as a short list, each with an owner if one is named and a date if one is stated. Drop everything that is not an action. If there are none, say so in one line.",
  check:
    "Do not rewrite. Read this against the house knowledge base and report what is wrong or risky in it — the 7-day test described where the 30-day one applies, a non-recourse characterisation of the note, a first-year figure quoted without §461(l), a deposit that disagrees with the frozen proposal, land described as the client's. Return the ORIGINAL text unchanged in `text`, and put every finding in `note`.",
};

export interface TextResult {
  text: string;
  note: string;
}

const TEXT_SCHEMA = {
  name: "text_assist",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["text", "note"],
    properties: {
      text: { type: "string", description: "The rewritten text, ready to replace the field." },
      note: {
        type: "string",
        description: "What changed, what you were unsure of, or what is wrong. Empty string if nothing.",
      },
    },
  },
} as const;

export async function assistText(args: {
  scope: PromptScope;
  action: TextAction;
  text: string;
  /** What this field is, so "tidy" knows whether it is a note or a title. */
  label?: string;
}): Promise<TextResult> {
  assertConfigured();
  const text = args.text?.trim();
  if (!text) throw new CrmError("There is nothing in that field to work on yet.", 400);

  const system = await buildScopedPrompt(args.scope);
  return structuredChat<TextResult>(
    [
      {
        role: "system",
        content: `${system}\n\n---\n\nYou are editing one field of an internal CRM record${
          args.label ? ` — "${args.label}"` : ""
        }. Never invent a fact, a name, a date or a figure that is not in the text you were given or in the record above. The result is shown to a person for approval before it replaces anything.`,
      },
      { role: "user", content: `${TEXT_BRIEFS[args.action]}\n\n---\n\n${text}` },
    ],
    TEXT_SCHEMA,
  );
}

/* -------------------------------------------------------------------------- */
/* Kind: todos — next actions for the board                                    */
/* -------------------------------------------------------------------------- */

/**
 * Note the shape: `crm_todos` has `title`, `notes`, `status` and `assignee` and
 * NO `client_id` — the board is the team's shared work list, not a per-account
 * one. So the account a card is about lives in the prose, which is why the
 * prompt asks for it to be named in the title.
 */
export interface TodoSuggestion {
  title: string;
  notes: string;
  status: (typeof TODO_STATUSES)[number];
  why: string;
}

const TODOS_SCHEMA = {
  name: "todo_suggestions",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["cards"],
    properties: {
      cards: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "notes", "status", "why"],
          properties: {
            title: {
              type: "string",
              description:
                "An imperative under 70 characters, naming the account where the card is about one.",
            },
            notes: { type: "string" },
            status: { type: "string", enum: [...TODO_STATUSES] },
            why: { type: "string", description: "What on the record makes this the next thing to do." },
          },
        },
      },
    },
  },
} as const;

/** Propose cards for the team's shared board. */
export async function suggestTodos(args: {
  scope: PromptScope;
  /** Free text: "we're pushing to close Q3", "focus on the unsigned contracts". */
  hint?: string;
}): Promise<{ cards: TodoSuggestion[] }> {
  assertConfigured();

  const [clients, existing] = await Promise.all([
    listClients().catch(() => []),
    listTodos().catch(() => []),
  ]);

  const system = await buildScopedPrompt(args.scope);
  const result = await structuredChat<{ cards: TodoSuggestion[] }>(
    [
      { role: "system", content: `${system}\n\n---\n\n${ASSIST_REGISTER}` },
      {
        role: "user",
        content: [
          `Propose the next actions for the team's shared board. At most six, fewest that are genuinely useful.`,
          ``,
          `## The accounts. Name one in the card title where the card is about it.`,
          clients.length
            ? clients
                .slice(0, 60)
                .map(
                  (c) =>
                    `- ${c.name} [${LABELS.clientStatus[c.status]}]` +
                    `${c.target_writeoff_cents != null ? `, targeting ${fmtMoney(c.target_writeoff_cents)}` : ""}` +
                    `, ${c.proposal_count} proposal(s), ${c.contract_count} contract(s), ${c.unit_count} unit(s)` +
                    `, last touched ${c.updated_at.slice(0, 10)}`,
                )
                .join("\n")
            : "There are no clients yet.",
          ``,
          `## Already on the board — do NOT propose these again`,
          existing.length
            ? existing.map((t) => `- [${t.status}] ${t.title}`).join("\n")
            : "The board is empty.",
          args.hint?.trim() ? `\n## What the person asked for\n${args.hint.trim()}` : "",
          ``,
          `Every card must be something a person could do this week and must name what on the record prompted it. New work goes in "todo". Use "doing" only for something the record shows is already underway.`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    TODOS_SCHEMA,
  );

  return {
    cards: (result.cards ?? [])
      .filter((c) => c?.title?.trim())
      .map((c) => ({
        ...c,
        // A status outside the enum would fail the CHECK on crm_todos at save
        // time, which surfaces as a 400 that reads like a bug in the board.
        status: TODO_STATUSES.includes(c.status) ? c.status : "todo",
      }))
      .slice(0, 6),
  };
}

/* -------------------------------------------------------------------------- */
/* Kind: triage — "who needs me today"                                         */
/* -------------------------------------------------------------------------- */

export interface TriageItem {
  client_id: string;
  headline: string;
  why: string;
  urgency: "now" | "this_week" | "watch";
}

const TRIAGE_SCHEMA = {
  name: "client_triage",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["items", "summary"],
    properties: {
      summary: { type: "string", description: "One sentence on the state of the book today." },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["client_id", "headline", "why", "urgency"],
          properties: {
            client_id: { type: "string" },
            headline: { type: "string", description: "The action, imperative, under 60 characters." },
            why: { type: "string" },
            urgency: { type: "string", enum: ["now", "this_week", "watch"] },
          },
        },
      },
    },
  },
} as const;

/** Rank the book by who needs attention, with the reason attached. */
export async function triageClients(args: { hint?: string } = {}): Promise<{
  summary: string;
  items: TriageItem[];
}> {
  assertConfigured();

  const clients = await listClients();
  if (!clients.length) return { summary: "There are no clients on the book yet.", items: [] };
  const validIds = new Set(clients.map((c) => c.id));

  const system = await buildScopedPrompt({ type: "global" });
  const result = await structuredChat<{ summary: string; items: TriageItem[] }>(
    [
      { role: "system", content: `${system}\n\n---\n\n${ASSIST_REGISTER}` },
      {
        role: "user",
        content: [
          `Which of these accounts needs attention, and why? At most eight, ordered most urgent first. An account with nothing to do about it should not appear at all.`,
          ``,
          clients
            .slice(0, 80)
            .map(
              (c) =>
                `- ${c.id} — ${c.name} [${LABELS.clientStatus[c.status]}, health ${c.health}]` +
                `${c.target_writeoff_cents != null ? `, targeting ${fmtMoney(c.target_writeoff_cents)}` : ""}` +
                `, invested ${fmtMoney(c.invested_cents)}` +
                `, ${c.proposal_count} proposal(s), ${c.contract_count} contract(s), ${c.unit_count} unit(s)` +
                `, last touched ${c.updated_at.slice(0, 10)}`,
            )
            .join("\n"),
          args.hint?.trim() ? `\n${args.hint.trim()}` : "",
          ``,
          `Base "why" on what is actually in the list and in the workspace context above — a stage that has not moved, a proposal sent with no contract behind it, a contract unsigned, a unit not yet placed in service. Today's date is ${new Date().toISOString().slice(0, 10)}.`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    TRIAGE_SCHEMA,
  );

  return {
    summary: result.summary ?? "",
    items: (result.items ?? [])
      .filter((i) => i && validIds.has(i.client_id))
      .slice(0, 8),
  };
}

/* -------------------------------------------------------------------------- */
/* Request dispatch                                                            */
/* -------------------------------------------------------------------------- */

export const ASSIST_KINDS = ["fields", "text", "todos", "triage"] as const;
export type AssistKind = (typeof ASSIST_KINDS)[number];

export function isAssistKind(v: unknown): v is AssistKind {
  return typeof v === "string" && (ASSIST_KINDS as readonly string[]).includes(v);
}

export function isTextAction(v: unknown): v is TextAction {
  return typeof v === "string" && (TEXT_ACTIONS as readonly string[]).includes(v);
}
