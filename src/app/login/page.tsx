import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { Wordmark } from "@/components/Wordmark";
import { LoginForm } from "@/components/LoginForm";

export const metadata: Metadata = {
  title: "Client Sign In",
  description: "Secure access to the BTB Holdings CRM.",
  robots: { index: false, follow: false },
};

/**
 * Only allow redirecting back into the platform zone, never to an arbitrary
 * URL — this prevents the ?next param from being abused as an open redirect.
 */
function safeNext(next: string | undefined): string {
  // Only allow redirecting back into a gated member area, never an arbitrary URL.
  if (next && next.startsWith("/crm")) {
    return next;
  }
  // /welcome, not /crm. Signing in does not imply CRM access — `CRM_ADMINS` is
  // a separate allow-list — and sending everyone to /crm meant an account that
  // is not on it landed on a bare 404. /welcome forwards straight to /crm for
  // anyone who IS admitted, so this costs an allowed user one redirect and
  // costs everyone else nothing but an explanation.
  //
  // A deep link (?next=/crm/...) is still honoured as-is: someone following a
  // link to a specific record who has no access SHOULD get the 404, because at
  // that point the 404 is the point.
  return "/welcome";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const dest = safeNext(next);

  // Already signed in? Skip the form.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) {
    redirect(dest);
  }

  return (
    <section className="relative flex min-h-[78vh] items-center justify-center overflow-hidden bg-navy-950 px-6 py-20">
      {/* Faint gold wash to echo the premium-bank aesthetic. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, #d4af37 0%, transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Wordmark tone="light" className="h-12" />
        </div>

        <div className="rounded-2xl border border-white/10 bg-white p-8 shadow-lift sm:p-10">
          <p className="eyebrow">Secure access</p>
          <h1 className="mt-3 font-serif text-2xl font-medium text-navy-900">
            Client sign in
          </h1>
          <p className="mt-2 text-sm text-navy-900/60">
            The Ziora underwriting platform is available to authorized partners.
            Sign in to continue.
          </p>

          <div className="mt-7">
            <LoginForm next={dest} />
          </div>

          <p className="mt-6 text-center text-sm text-navy-900/60">
            Need an account?{" "}
            <Link href="/register" className="link-underline">
              Request access
            </Link>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-paper-50/50">
          Need access? Contact your Ziora relationship manager.
        </p>
      </div>
    </section>
  );
}
