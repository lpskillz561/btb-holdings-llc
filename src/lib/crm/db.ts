// Query helpers shared by every CRM module.
//
// Each helper calls `ensureAppSchema()` first, so the tables exist on the very
// first request after a deploy without anyone remembering to run a migration.
// The schema promise is memoised, so this costs one `await` per query.

import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db";
import { ensureAppSchema } from "./schema";

/** Thrown by CRM code paths; carries the HTTP status the API should return. */
export class CrmError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CrmError";
    this.status = status;
  }
}

export function newId(): string {
  return randomUUID();
}

/** ISO-8601 UTC, matching the TEXT timestamp columns. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Today as 'YYYY-MM-DD', the format of every plain-date column. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// The generics are deliberately unconstrained: the row types in ./types are
// interfaces, and an interface has no implicit index signature, so a
// `Record<string, unknown>` bound would reject every one of them.
export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ensureAppSchema();
  const res = await getPool().query(sql, params);
  return res.rows as T[];
}

export async function queryOne<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Build an INSERT from a plain object. Keys are column names (all internal,
 * never user-supplied); values are bound.
 */
export function buildInsert(
  table: string,
  values: Record<string, unknown>,
): { sql: string; params: unknown[] } {
  const cols = Object.keys(values);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  return {
    sql: `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
    params: cols.map((c) => values[c]),
  };
}

/**
 * Build a PATCH-style UPDATE over an allow-list of columns.
 *
 * PATCH semantics, which the forms depend on: a key **absent** from `patch`
 * leaves the column alone, while an explicit `null` clears it. The form helpers
 * normalise empty inputs to `null` rather than `undefined` precisely so a
 * cleared field is distinguishable from an untouched one.
 *
 * Returns null when nothing in the allow-list was supplied.
 */
export function buildUpdate(
  table: string,
  id: string,
  patch: Record<string, unknown>,
  allowed: readonly string[],
): { sql: string; params: unknown[] } | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const col of allowed) {
    if (!(col in patch)) continue;
    params.push(patch[col]);
    sets.push(`${col} = $${params.length}`);
  }
  if (sets.length === 0) return null;
  params.push(nowIso());
  sets.push(`updated_at = $${params.length}`);
  params.push(id);
  return {
    sql: `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params,
  };
}

/** Append to the activity feed. Never throws — a lost feed entry must not fail the write it describes. */
export async function logActivity(entry: {
  entity_type: string;
  entity_id?: string | null;
  client_id?: string | null;
  verb: string;
  summary: string;
  actor_email?: string | null;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO crm_activity (id, entity_type, entity_id, client_id, verb, summary, actor_email, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        newId(),
        entry.entity_type,
        entry.entity_id ?? null,
        entry.client_id ?? null,
        entry.verb,
        entry.summary,
        entry.actor_email ?? null,
        nowIso(),
      ],
    );
  } catch (err) {
    console.error("crm: failed to log activity", err);
  }
}

/* -------------------------------------------------------------------------- */
/* Input coercion                                                              */
/* -------------------------------------------------------------------------- */

/** Trimmed string, or null for blank/absent. Returns undefined when the key is absent (PATCH). */
export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Finite number, or null. Tolerates "$1,250,000" and "12.5%"-style input. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Dollars (as typed by a human) to integer cents. `Math.round` after the
 * multiply, so 1234.565 doesn't land a cent low through float representation.
 */
export function cents(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n * 100);
}

/** A percentage as typed (37 or 37.5) to basis points. */
export function bps(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n * 100);
}

/**
 * Checkbox to boolean, or null when not supplied.
 *
 * Accepts what an HTML form actually sends — "on", "true", "1", "yes" — as well
 * as a real JSON boolean, because the same endpoints take both. Anything else
 * present but unrecognised is false rather than null: a pad that says "no
 * sewer" is a different claim from one where nobody has looked yet, and only
 * the second should read as unknown.
 */
export function bool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v;
  return ["on", "true", "1", "yes"].includes(String(v).trim().toLowerCase());
}

/** 'YYYY-MM-DD', or null. Rejects anything that isn't a real date. */
export function date(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * A full ISO-8601 instant, or null. The counterpart to `date` for the columns
 * that need a time of day — a meeting at 09:00 and one at 16:00 are the same row
 * to `date`, which would collapse a day's calls into one point on the calendar.
 *
 * Normalised through `toISOString()` so it matches TS_DEFAULT in ./schema
 * exactly. These columns are TEXT and are sorted and compared as TEXT, so a
 * value with an offset ("…+01:00") rather than a "Z" would sort into the wrong
 * place rather than fail loudly.
 */
export function timestamp(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  // A bare 'YYYY-MM-DD' is read as UTC midnight, matching `date` above; anything
  // else is left to Date to interpret, including a local-time form from a
  // datetime-local input.
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Narrow an untrusted value to a member of an enum array, else fall back. */
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Copy `keys` from a request body into a column patch, applying `coerce` to
 * each, and skipping keys the body didn't mention. This is what preserves PATCH
 * semantics through the API layer.
 */
export function pick(
  body: Record<string, unknown>,
  keys: readonly string[],
  coerce: (v: unknown) => unknown = str,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in body) out[key] = coerce(body[key]);
  }
  return out;
}
