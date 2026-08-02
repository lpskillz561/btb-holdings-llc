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

function isAllowed(session: SessionPayload): boolean {
  const list = allowList();
  return list === null || list.includes(session.sub.trim().toLowerCase());
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
