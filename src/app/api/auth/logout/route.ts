import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

// Clearing the session is exposed over GET so a plain <a href="/api/auth/logout">
// link (including one rendered inside the cross-zone platform header) signs the
// visitor out and returns them to the public site.
function endSession(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export const GET = endSession;
export const POST = endSession;
