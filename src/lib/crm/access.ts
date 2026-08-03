// Who may use the CRM.
//
// By default every authenticated portal user can, which is the configured
// behaviour. Because these tables hold clients' income and tax profiles, an
// optional `CRM_ADMINS` env var (comma-separated emails) narrows access to
// named staff without any code change — set it and everyone else gets a 404
// from the pages and a 403 from the API.

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from "@/lib/auth";
import { CrmError } from "./db";

/** Parsed allow-list, or null when unset (⇒ open to all portal users). */
function allowList(): string[] | null {
  const raw = process.env.CRM_ADMINS?.trim();
  if (!raw) return null;
  const emails = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return emails.length > 0 ? emails : null;
}

/**
 * Whether one email is on the allow-list, without needing a session.
 *
 * The admin screen needs this: registration does NOT grant CRM access, so a
 * newly-registered user sits in `portal_users` looking perfectly normal while
 * 404ing on every CRM page. Without this the only way to notice was for them to
 * report it — which is exactly how it was found.
 */
export function emailHasCrmAccess(email: string): boolean {
  const list = allowList();
  return list === null || list.includes(email.trim().toLowerCase());
}

function isAllowed(session: SessionPayload): boolean {
  return emailHasCrmAccess(session.sub);
}

/**
 * Session for a CRM API request. Throws CrmError (401/403) when the caller has
 * no session or isn't on the allow-list — routes under /api aren't covered by
 * the middleware, so this is the only gate they get.
 */
export async function requireCrmApiUser(req: NextRequest): Promise<SessionPayload> {
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) throw new CrmError("Not authorized.", 401);
  if (!isAllowed(session)) throw new CrmError("This account does not have CRM access.", 403);
  return session;
}

/** Session for a CRM page (server component). Null when the visitor may not use the CRM. */
export async function getCrmPageUser(): Promise<SessionPayload | null> {
  const session = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session || !isAllowed(session)) return null;
  return session;
}

/** True when the signed-in user should see the CRM card on the dashboard. */
export async function hasCrmAccess(session: SessionPayload | null): Promise<boolean> {
  return session !== null && isAllowed(session);
}

/* -------------------------------------------------------------------------- */
/* Superusers — user administration                                            */
/* -------------------------------------------------------------------------- */

/**
 * Who may administer accounts.
 *
 * This gate FAILS CLOSED, which is the opposite of `allowList()` above and is
 * deliberate. CRM access opening up to every signed-in user when `CRM_ADMINS`
 * is unset is a defensible default for reading the book of business. Applying
 * the same default to a screen that deletes accounts and resets passwords would
 * mean that forgetting one environment variable hands account control to
 * everyone who can register.
 *
 * `CRM_SUPERUSERS` if set; otherwise `CRM_ADMINS`; otherwise **nobody**.
 */
function superUserList(): string[] {
  const raw = process.env.CRM_SUPERUSERS?.trim() || process.env.CRM_ADMINS?.trim() || "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperUser(session: SessionPayload | null): boolean {
  if (!session) return false;
  const list = superUserList();
  // Empty list denies everyone, including whoever is reading this.
  if (list.length === 0) return false;
  return list.includes(session.sub.trim().toLowerCase());
}

/** Session for an admin page. Null when the visitor may not administer users. */
export async function getSuperUser(): Promise<SessionPayload | null> {
  const session = await getCrmPageUser();
  return isSuperUser(session) ? session : null;
}

/** Session for an admin API route. Throws 401/403 rather than returning null. */
export async function requireSuperUser(req: NextRequest): Promise<SessionPayload> {
  const session = await requireCrmApiUser(req);
  if (!isSuperUser(session)) {
    throw new CrmError(
      "This account may not administer users. Add it to CRM_SUPERUSERS.",
      403,
    );
  }
  return session;
}
