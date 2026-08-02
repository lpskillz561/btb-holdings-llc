import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Gate the CRM. An unauthenticated visitor is bounced to /login and never
// reaches a page.
//
// This is NOT the only gate. `/api` is outside the matcher below, so every
// /api/crm route enforces the session itself through withCrm/withCrmParams in
// lib/crm/rest.ts. Removing that would leave the whole API open.
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  if (session) {
    return NextResponse.next();
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/crm", "/crm/:path*"],
};
