import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The ALB target group's health check target.
//
// Deliberately NOT wrapped in withCrm: the load balancer has no session, and
// every other path in this app either redirects (`/` and `/crm`) or 401s, none
// of which a 200-matcher health check can pass.
//
// Deliberately does NOT touch the database either. This is a liveness check —
// "is the Node server up" — not a readiness check. There is one instance behind
// this load balancer, so failing the check during a database blip would take the
// site down rather than shift traffic somewhere healthy. A database problem
// should surface as a broken page that says so, not as a target with no targets.
export function GET() {
  return NextResponse.json({ ok: true });
}
