// Ticket keys — BTB-42.
//
// This module is PURE: no environment, no Node API, no database. It is imported
// by client components (the board, the card dialog, the subtask list), and
// `process.env` in a client bundle is silently `undefined` rather than an error
// — so a component that resolved its own prefix would quietly render every key
// as `undefined-42`. Same rule as lib/crm/equipment.ts, and for the same reason.
//
// The prefix is therefore a CONSTANT rather than configuration. Changing it is a
// one-line code change here, which is the honest trade: threading a string
// through every board component, the card dialog, the comment renderer and the
// search parser to make it an SSM value would be a lot of plumbing for something
// nobody is going to change twice.
//
// If it ever does change, note that OLD KEYS DO NOT MOVE. `ticket_number` is the
// stored fact and the prefix is presentation, so BTB-42 simply starts rendering
// as the new prefix. Anything written down elsewhere — a chat message, a
// meeting note — would then name a ticket that no longer reads that way.

export const TICKET_PREFIX = "BTB";

/**
 * A ticket number as people say it.
 *
 * Nullable in, because `crm_todos.ticket_number` is a nullable column: a card
 * inserted by hand, or one caught between the deploy and the first request that
 * runs the backfill, has none. Rendering "BTB-null" is worse than rendering
 * nothing, so callers get null and decide.
 */
export function formatTicket(n: number | string | null | undefined): string | null {
  if (n === null || n === undefined || n === "") return null;
  const value = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(value)) return null;
  return `${TICKET_PREFIX}-${value}`;
}

/**
 * Pull a ticket number out of something a person typed.
 *
 * Accepts "BTB-42", "btb 42", "#42" and a bare "42", because all four are what
 * someone actually types into a search box when they mean that card. Returns
 * null when the text is not a key, which is how the board's search decides
 * between "jump to a ticket" and "search the text".
 */
export function parseTicket(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  const match = text.match(
    new RegExp(`^(?:${TICKET_PREFIX}[\\s-]*|#)?(\\d+)$`, "i"),
  );
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
