// Account administration: list, block, reset, remove.
//
// Two facts shape everything here, and both are easy to get wrong:
//
// 1. THERE ARE TWO KINDS OF ACCOUNT. `AUTH_USERS` accounts live in the runtime
//    environment and are checked by the login route BEFORE the database. They
//    are not rows, so blocking or deleting them here would appear to succeed
//    and change nothing. Every mutation below refuses them explicitly and says
//    where to go instead, rather than no-opping politely.
//
// 2. YOU CAN LOCK YOURSELF OUT. Blocking or deleting your own account, or the
//    last remaining one, is refused — a CRM with no way back in is a worse
//    outcome than any of these operations is worth.

import { randomBytes } from "node:crypto";
import { envUserEmails, envUserExists } from "@/lib/credentials";
import { hashPassword } from "@/lib/portalUsers";
import { CrmError, logActivity, nowIso, query, queryOne } from "./db";

export interface AdminUser {
  email: string;
  name: string | null;
  created_at: string;
  last_login_at: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  password_changed_at: string | null;
  /** True when this email ALSO exists as an env account, which wins at login. */
  env_account: boolean;
}

export async function listUsers(): Promise<AdminUser[]> {
  const rows = await query<Omit<AdminUser, "env_account">>(
    `SELECT email, name, created_at, last_login_at,
            blocked_at, blocked_reason, password_changed_at
     FROM portal_users
     ORDER BY created_at DESC`,
  );
  return rows.map((r) => ({ ...r, env_account: envUserExists(r.email) }));
}

const normalise = (email: string) => email.trim().toLowerCase();

/**
 * Refuse anything that would leave nobody able to sign in.
 *
 * "Able to sign in" means unblocked rows in `portal_users` PLUS the built-in
 * `AUTH_USERS` accounts, which are not rows and are checked before the database.
 * Counting only the table got this wrong in the obvious direction: with one
 * registered user and a working built-in account, it refused to remove that user
 * on the grounds of a lockout that could not happen.
 */
async function assertNotSelfDestructive(target: string, actor: string, verb: string) {
  if (normalise(target) === normalise(actor)) {
    throw new CrmError(`You cannot ${verb} your own account.`, 400);
  }

  const [{ n }] = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM portal_users WHERE blocked_at IS NULL AND email <> $1`,
    [normalise(target)],
  );
  // Built-in accounts that are not also the target. An env account cannot be
  // blocked or removed here at all, so any that exist survive this operation.
  const envSurvivors = envUserEmails().filter((e) => e !== normalise(target)).length;

  if (n + envSurvivors === 0) {
    throw new CrmError(
      `This is the only account that can still sign in. ${
        verb.charAt(0).toUpperCase() + verb.slice(1)
      } would lock everyone out.`,
      400,
    );
  }
}

/**
 * An env account is not a row, so any change here is theatre. Say so.
 *
 * Note the login route checks env credentials FIRST, so even where a row of the
 * same name exists, blocking the row does not stop the sign-in.
 */
function assertNotEnvAccount(email: string, verb: string) {
  if (envUserExists(email)) {
    throw new CrmError(
      `${email} is a built-in account defined by the AUTH_USERS environment variable, not a registered user. ` +
        `The login route checks it before the database, so ${verb} here would have no effect. ` +
        `Change AUTH_USERS in SSM (/btb-crm/AUTH_USERS) and redeploy instead.`,
      400,
    );
  }
}

async function requireRow(email: string): Promise<AdminUser> {
  const row = await queryOne<AdminUser>(
    `SELECT email, name, created_at, last_login_at, blocked_at, blocked_reason,
            password_changed_at
     FROM portal_users WHERE email = $1`,
    [normalise(email)],
  );
  if (!row) throw new CrmError("No such registered user.", 404);
  return row;
}

export async function blockUser(email: string, reason: string | null, actor: string) {
  const target = normalise(email);
  assertNotEnvAccount(target, "blocking");
  await requireRow(target);
  await assertNotSelfDestructive(target, actor, "block");

  const stamp = nowIso();
  await query(
    `UPDATE portal_users SET blocked_at = $2, blocked_reason = $3, updated_at = $2 WHERE email = $1`,
    [target, stamp, reason],
  );
  await logActivity({
    entity_type: "portal_user",
    entity_id: target,
    verb: "blocked",
    summary: `Blocked ${target}${reason ? `: ${reason}` : ""}`,
    actor_email: actor,
  });
}

export async function unblockUser(email: string, actor: string) {
  const target = normalise(email);
  await requireRow(target);
  await query(
    `UPDATE portal_users SET blocked_at = NULL, blocked_reason = NULL, updated_at = $2 WHERE email = $1`,
    [target, nowIso()],
  );
  await logActivity({
    entity_type: "portal_user",
    entity_id: target,
    verb: "unblocked",
    summary: `Unblocked ${target}`,
    actor_email: actor,
  });
}

/**
 * Reset to a generated temporary password, returned ONCE.
 *
 * Generated rather than chosen: an administrator inventing a password for
 * someone else reliably produces a weak and reused one. It is returned in the
 * response and never stored in plaintext, so it exists in exactly one place —
 * the screen of the person who pressed the button.
 */
export async function resetPassword(email: string, actor: string): Promise<string> {
  const target = normalise(email);
  assertNotEnvAccount(target, "resetting the password");
  await requireRow(target);

  // 18 bytes of base64url, minus lookalike characters, is ~100 bits of entropy
  // and still readable down a phone line.
  const temporary = randomBytes(18)
    .toString("base64url")
    .replace(/[-_0OlI1]/g, "")
    .slice(0, 20);

  const stamp = nowIso();
  await query(
    `UPDATE portal_users SET password_hash = $2, password_changed_at = $3, updated_at = $3 WHERE email = $1`,
    [target, await hashPassword(temporary), stamp],
  );
  await logActivity({
    entity_type: "portal_user",
    entity_id: target,
    verb: "password_reset",
    summary: `Reset the password for ${target}`,
    actor_email: actor,
  });
  return temporary;
}

export async function removeUser(email: string, actor: string) {
  const target = normalise(email);
  assertNotEnvAccount(target, "removing the account");
  await requireRow(target);
  await assertNotSelfDestructive(target, actor, "remove");

  await query(`DELETE FROM portal_users WHERE email = $1`, [target]);
  await logActivity({
    entity_type: "portal_user",
    entity_id: target,
    verb: "removed",
    summary: `Removed the account ${target}`,
    actor_email: actor,
  });
}
