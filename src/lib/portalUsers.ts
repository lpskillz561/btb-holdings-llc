// Self-service portal accounts, stored in Postgres.
//
// This replaces the JSON file on the `ziora-web-data` volume (lib/userStore.ts).
// Two reasons, either sufficient on its own:
//
//   * Cloudflare Workers has no filesystem. `node:fs` and a mounted volume are
//     the single hardest blocker to running this app on Workers.
//   * Nothing was backing that file up. The only record of who can sign in
//     lived on one Docker volume on one Mac Mini.
//
// Password hashing had to change with it. The old scheme was `scryptSync` from
// `node:crypto`, which is not dependable on Workers. New and rotated passwords
// use PBKDF2-SHA256 through the Web Crypto API, which is identical in Node and
// in workerd. Legacy scrypt hashes still verify on Node and are transparently
// upgraded on the next successful sign-in, so nobody is locked out by the move —
// see `verifyPortalUser`.

import { query, queryOne, nowIso } from "@/lib/crm/db";

/**
 * PBKDF2 iterations. A balance: high enough to be a real cost to an attacker,
 * low enough to stay inside a Worker's CPU budget on every sign-in. Recorded in
 * the hash string itself, so this can be raised later without invalidating
 * existing passwords.
 */
const PBKDF2_ITERATIONS = 210_000;
const KEY_BITS = 256;

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function fromHex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Constant-time comparison. Never short-circuits on the first differing byte. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** `pbkdf2:<iterations>:<saltB64>:<hashB64>` */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${toBase64(salt)}:${toBase64(hash)}`;
}

/**
 * Verify against either scheme.
 *
 * Legacy `scrypt:<saltHex>:<hashHex>` is checked through `node:crypto`, imported
 * dynamically so the module still loads where that function is absent. On a
 * runtime without it the verification simply fails closed rather than throwing.
 */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");

  if (parts[0] === "pbkdf2" && parts.length === 4) {
    const iterations = Number(parts[1]);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;
    const expected = fromBase64(parts[3]);
    const actual = await pbkdf2(password, fromBase64(parts[2]), iterations);
    return timingSafeEqual(expected, actual);
  }

  if (parts[0] === "scrypt" && parts.length === 3) {
    try {
      const { scryptSync } = await import("node:crypto");
      const expected = fromHex(parts[2]);
      const actual = new Uint8Array(
        scryptSync(password, Buffer.from(fromHex(parts[1])), expected.length),
      );
      return timingSafeEqual(expected, actual);
    } catch {
      // scrypt unavailable (or a malformed hash) — fail closed.
      return false;
    }
  }

  return false;
}

/** True when a hash should be rewritten on the next successful sign-in. */
function needsRehash(stored: string): boolean {
  const parts = stored.split(":");
  if (parts[0] !== "pbkdf2") return true;
  return Number(parts[1]) < PBKDF2_ITERATIONS;
}

interface PortalUserRow {
  email: string;
  name: string | null;
  password_hash: string;
}

const normalise = (email: string) => email.trim().toLowerCase();

/* -------------------------------------------------------------------------- */
/* One-time import from the legacy JSON store                                  */
/* -------------------------------------------------------------------------- */

let imported: Promise<void> | null = null;

/**
 * Copy accounts out of the old JSON file the first time this runs, so the move
 * to Postgres doesn't sign anybody out.
 *
 * Only fills an empty table, and only touches the filesystem where one exists —
 * on Workers the dynamic import fails and this is a no-op, which is correct:
 * by then the accounts are already in Postgres.
 */
async function importLegacyUsers(): Promise<void> {
  const [{ n }] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM portal_users`);
  if (n > 0) return;

  const path = process.env.USER_STORE;
  if (!path) return;

  try {
    const { readFile } = await import("node:fs/promises");
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed) || parsed.length === 0) return;

    for (const user of parsed) {
      if (!user?.email || !user?.passwordHash) continue;
      await query(
        `INSERT INTO portal_users (email, name, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4) ON CONFLICT (email) DO NOTHING`,
        [normalise(user.email), user.name ?? null, user.passwordHash, user.createdAt ?? nowIso()],
      );
    }
    console.log(`portal: imported ${parsed.length} account(s) from ${path}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.error("portal: could not import legacy user store", err);
    }
  }
}

function ready(): Promise<void> {
  if (!imported) {
    imported = importLegacyUsers().catch((err) => {
      imported = null;
      throw err;
    });
  }
  return imported;
}

/* -------------------------------------------------------------------------- */
/* Store                                                                       */
/* -------------------------------------------------------------------------- */

export async function portalUserExists(email: string): Promise<boolean> {
  await ready();
  const row = await queryOne<{ email: string }>(
    `SELECT email FROM portal_users WHERE email = $1`,
    [normalise(email)],
  );
  return row !== null;
}

/** Create an account. Returns the canonical email, or null if one already exists. */
export async function createPortalUser(
  email: string,
  password: string,
  name?: string,
): Promise<string | null> {
  await ready();
  const target = normalise(email);
  const rows = await query<{ email: string }>(
    `INSERT INTO portal_users (email, name, password_hash, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (email) DO NOTHING
     RETURNING email`,
    [target, name?.trim() || null, await hashPassword(password), nowIso()],
  );
  // ON CONFLICT DO NOTHING returns no row when the account already existed —
  // which is the check and the insert in one statement, with no race between.
  return rows[0]?.email ?? null;
}

export async function getPortalUserName(email: string): Promise<string | undefined> {
  await ready();
  const row = await queryOne<{ name: string | null }>(
    `SELECT name FROM portal_users WHERE email = $1`,
    [normalise(email)],
  );
  return row?.name?.trim() || undefined;
}

/**
 * Verify an email/password pair. Returns the canonical email on success.
 *
 * On success with a legacy or weaker hash, the password is silently re-hashed
 * with the current scheme — the migration path off scrypt, one sign-in at a time.
 */
export async function verifyPortalUser(email: string, password: string): Promise<string | null> {
  await ready();
  const target = normalise(email);
  const user = await queryOne<PortalUserRow>(
    `SELECT email, name, password_hash FROM portal_users WHERE email = $1`,
    [target],
  );
  if (!user) return null;
  if (!(await verifyPassword(password, user.password_hash))) return null;

  const stamp = nowIso();
  if (needsRehash(user.password_hash)) {
    try {
      await query(
        `UPDATE portal_users SET password_hash = $2, last_login_at = $3, updated_at = $3 WHERE email = $1`,
        [target, await hashPassword(password), stamp],
      );
    } catch (err) {
      // An upgrade failure must never block a valid sign-in.
      console.error("portal: could not upgrade password hash", err);
    }
  } else {
    await query(`UPDATE portal_users SET last_login_at = $2 WHERE email = $1`, [target, stamp]);
  }
  return user.email;
}

/** Record a contact-form lead. Replaces the append-to-file log. */
export async function recordContactSubmission(lead: {
  name: string;
  email: string;
  company?: string;
  phone?: string;
  interest?: string;
  message: string;
}): Promise<void> {
  await query(
    `INSERT INTO contact_submissions (id, name, email, company, phone, interest, message, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      crypto.randomUUID(),
      lead.name,
      lead.email,
      lead.company || null,
      lead.phone || null,
      lead.interest || null,
      lead.message,
      nowIso(),
    ],
  );
}
