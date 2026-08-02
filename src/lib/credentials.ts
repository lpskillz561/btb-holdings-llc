// Credential checking for the platform login. Runs only in the Node runtime
// (the login route handler), never in the Edge middleware.
//
// Authorized users come from the AUTH_USERS env var as a comma-separated list
// of `email:password` pairs, e.g.
//
//   AUTH_USERS="info@ziora.io:s3cret,partner@example.com:another"
//
// Passwords live in the runtime environment, not in the image or the repo.

const encoder = new TextEncoder();

interface Credential {
  email: string;
  password: string;
}

function loadUsers(): Credential[] {
  const raw = process.env.AUTH_USERS ?? "";
  const users = raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(":");
      if (idx === -1) return null;
      return {
        email: pair.slice(0, idx).trim().toLowerCase(),
        password: pair.slice(idx + 1),
      };
    })
    .filter((c): c is Credential => !!c && !!c.email && !!c.password);

  // Dev convenience: if no users are configured, allow a single well-known
  // account so `next dev` is testable. Disabled in production.
  if (users.length === 0 && process.env.NODE_ENV !== "production") {
    return [{ email: "info@ziora.io", password: "demo" }];
  }
  return users;
}

/** Constant-time string comparison to avoid leaking length/content via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const aB = encoder.encode(a);
  const bB = encoder.encode(b);
  const len = Math.max(aB.length, bB.length);
  let diff = aB.length ^ bB.length;
  for (let i = 0; i < len; i++) {
    diff |= (aB[i] ?? 0) ^ (bB[i] ?? 0);
  }
  return diff === 0;
}

/** True if the email belongs to a built-in (env-configured) account. */
export function envUserExists(email: string): boolean {
  const target = email.trim().toLowerCase();
  return loadUsers().some((u) => u.email === target);
}

/**
 * Emails of the built-in accounts. Passwords are deliberately not exposed.
 *
 * Used by the admin screen's lockout guard, which has to know that these
 * accounts can still sign in even when every row in `portal_users` is gone —
 * otherwise it refuses to delete the last registered user while an env account
 * is sitting there perfectly able to log in.
 */
export function envUserEmails(): string[] {
  return loadUsers().map((u) => u.email);
}

/**
 * Verify an email/password pair. Returns the canonical email on success, or
 * null. Always checks against every configured user so timing does not reveal
 * whether the email exists.
 */
export function verifyCredentials(
  email: string,
  password: string,
): string | null {
  const target = email.trim().toLowerCase();
  let matched: string | null = null;
  for (const user of loadUsers()) {
    const emailOk = timingSafeEqual(user.email, target);
    const passOk = timingSafeEqual(user.password, password);
    if (emailOk && passOk) matched = user.email;
  }
  return matched;
}
