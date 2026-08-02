import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_TTL, createSessionToken } from "@/lib/auth";
import { envUserExists } from "@/lib/credentials";
import { createPortalUser, portalUserExists } from "@/lib/portalUsers";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

/**
 * Registration policy:
 *   • REGISTRATION_OPEN=true        → anyone may register (no code).
 *   • REGISTRATION_CODE=<code>      → must present the matching access code.
 *   • neither set                   → registration is DISABLED in production;
 *                                     allowed in dev so it's testable.
 */
function registrationGate(code: string): { ok: boolean; status?: number; error?: string } {
  if (process.env.REGISTRATION_OPEN === "true") return { ok: true };

  const required = process.env.REGISTRATION_CODE ?? "";
  if (required) {
    if (code === required) return { ok: true };
    return { ok: false, status: 403, error: "Invalid access code." };
  }

  if (process.env.NODE_ENV !== "production") return { ok: true };
  return {
    ok: false,
    status: 403,
    error: "Registration is currently closed. Please contact your Ziora relationship manager.",
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name : "";
  const code = typeof body.code === "string" ? body.code : "";

  const gate = registrationGate(code);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD} characters.` },
      { status: 400 },
    );
  }

  if (envUserExists(email) || (await portalUserExists(email))) {
    return NextResponse.json(
      { error: "An account with that email already exists. Try signing in." },
      { status: 409 },
    );
  }

  // Sign the session cookie FIRST. If signing fails (e.g. AUTH_SECRET is not
  // configured) we bail out here, before persisting anything — otherwise we'd
  // leave an orphaned account that can never sign in and blocks re-registration.
  let token: string;
  try {
    token = await createSessionToken(email.trim().toLowerCase(), name);
  } catch (err) {
    console.error("register: could not sign session (is AUTH_SECRET set?)", err);
    return NextResponse.json(
      { error: "The server is not configured for sign-in yet. Please contact support." },
      { status: 500 },
    );
  }

  let created: string | null;
  try {
    created = await createPortalUser(email, password, name);
  } catch (err) {
    // Most likely the persistent store (USER_STORE / the /data volume) is not
    // writable — e.g. the volume is owned by root while the app runs unprivileged.
    // Surface a real message instead of an opaque 500 that the client renders as
    // the generic "Could not create your account".
    console.error("register: could not persist user (is USER_STORE writable?)", err);
    return NextResponse.json(
      { error: "The server could not save your account right now. Please contact support." },
      { status: 500 },
    );
  }
  if (!created) {
    return NextResponse.json(
      { error: "An account with that email already exists. Try signing in." },
      { status: 409 },
    );
  }

  // Auto-sign-in: set the session cookie so the new user lands in the platform.
  const proto =
    req.headers.get("x-forwarded-proto") ??
    req.nextUrl.protocol.replace(":", "");

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: proto === "https",
    path: "/",
    maxAge: SESSION_TTL,
  });
  return res;
}
