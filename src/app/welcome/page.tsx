// Where a signed-in account lands when it has no CRM access yet.
//
// Registration does not grant CRM access — `CRM_ADMINS` does, and it is an
// environment variable. So a newly-registered user was being sent straight to
// /crm and meeting a 404, which reads as a broken site rather than as "you are
// not admitted yet". The 404 itself is correct and stays: an account without
// access should not learn what lives at /crm. What was wrong was walking people
// into it.
//
// This page is the destination instead. It is deliberately NOT under /crm — it
// is outside the middleware matcher, so it gates itself:
//
//   no session          → /login
//   session + access    → /crm  (so anyone admitted never sees this page)
//   session, no access  → the message below
//
// It names no part of the CRM. Someone who registered had to present the
// registration code, so they were invited; but this page still says only that
// an account exists and that access is granted separately.

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { Wordmark } from "@/components/Wordmark";
import { emailHasCrmAccess } from "@/lib/crm/access";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Account created",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const session = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  // Already admitted — this page has nothing to tell them. The extra hop costs
  // one redirect and means the whole sign-in flow can point here unconditionally.
  if (emailHasCrmAccess(session.sub)) redirect("/crm");

  return (
    <section className="relative flex min-h-[78vh] items-center justify-center overflow-hidden bg-navy-950 px-6 py-20">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          background: "radial-gradient(60% 50% at 50% 0%, #d4af37 0%, transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-lg text-center">
        <Wordmark className="mx-auto h-8 w-auto" />

        <h1 className="mt-8 font-serif text-3xl font-medium text-paper-50">
          Your account is ready
        </h1>

        <p className="mt-4 text-paper-50/70">
          You are signed in as{" "}
          <span className="font-medium text-paper-50">{session.sub}</span>. Access to the
          client platform is enabled separately by your relationship manager — you will hear
          from us once it is switched on.
        </p>

        <p className="mt-4 text-sm text-paper-50/50">
          Nothing further is needed from you. If you were expecting access already, reply to
          the invitation you received or contact us at {site.email}.
        </p>

        <div className="mt-10 flex items-center justify-center gap-6 text-sm">
          {/* Deliberately a full-page navigation: this re-runs the check above,
              so someone told "you're in now" can simply reload rather than being
              told to clear a cookie. */}
          <a href="/welcome" className="text-gold-400 underline-offset-4 hover:underline">
            Check again
          </a>
          <a href="/api/auth/logout" className="text-paper-50/60 hover:text-paper-50">
            Sign out
          </a>
        </div>

        <p className="mt-10 text-xs text-paper-50/35">
          <Link href="/login" className="hover:text-paper-50/60">
            {site.name}
          </Link>
        </p>
      </div>
    </section>
  );
}
