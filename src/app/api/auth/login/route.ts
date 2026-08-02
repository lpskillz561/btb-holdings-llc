import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_TTL, createSessionToken } from "@/lib/auth";
import { verifyCredentials } from "@/lib/credentials";
import { getPortalUserName, verifyPortalUser } from "@/lib/portalUsers";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let email = "";
  let password = "";

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    email = typeof body.email === "string" ? body.email : "";
    password = typeof body.password === "string" ? body.password : "";
  } else {
    const form = await req.formData().catch(() => null);
    email = form ? String(form.get("email") ?? "") : "";
    password = form ? String(form.get("password") ?? "") : "";
  }

  // Built-in env accounts first, then self-registered users on the volume.
  const matched =
    verifyCredentials(email, password) ??
    (await verifyPortalUser(email, password));
  if (!matched) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 },
    );
  }

  // Carry the registered display name in the session so the dashboard can greet
  // by name; env/bootstrap accounts have none and fall back to the email.
  const name = await getPortalUserName(matched);

  let token: string;
  try {
    token = await createSessionToken(matched, name);
  } catch (err) {
    console.error("login: could not sign session (is AUTH_SECRET set?)", err);
    return NextResponse.json(
      { error: "The server is not configured for sign-in yet. Please contact support." },
      { status: 500 },
    );
  }

  // Mark the cookie Secure only when the request actually came in over HTTPS, so
  // sign-in works on a plain-http localhost deployment but stays Secure behind
  // TLS in production.
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
