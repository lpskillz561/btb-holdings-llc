import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { Wordmark } from "@/components/Wordmark";
import { RegisterForm } from "@/components/RegisterForm";

export const metadata: Metadata = {
  title: "Request Access",
  description: "Create an account for the Ziora AI underwriting platform.",
  robots: { index: false, follow: false },
};

function safeNext(next: string | undefined): string {
  if (next && (next.startsWith("/app") || next.startsWith("/crm"))) {
    return next;
  }
  return "/crm";
}

// Mirror the server-side registration policy so the UI matches (whether to show
// the access-code field, or a "closed" message instead of the form).
function registrationState(): { open: boolean; codeRequired: boolean } {
  if (process.env.REGISTRATION_OPEN === "true") {
    return { open: true, codeRequired: false };
  }
  if (process.env.REGISTRATION_CODE) {
    return { open: true, codeRequired: true };
  }
  // No code + not open: open in dev for testing, closed in production.
  return { open: process.env.NODE_ENV !== "production", codeRequired: false };
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const dest = safeNext(next);

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) {
    redirect(dest);
  }

  const { open, codeRequired } = registrationState();

  return (
    <section className="relative flex min-h-[78vh] items-center justify-center overflow-hidden bg-navy-950 px-6 py-20">
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
          <Wordmark tone="light" />
        </div>

        <div className="rounded-2xl border border-white/10 bg-white p-8 shadow-lift sm:p-10">
          <p className="eyebrow">Request access</p>
          <h1 className="mt-3 font-serif text-2xl font-medium text-navy-900">
            Create your account
          </h1>

          {open ? (
            <>
              <p className="mt-2 text-sm text-navy-900/60">
                Set up access to the Ziora underwriting platform.
              </p>
              <div className="mt-7">
                <RegisterForm next={dest} codeRequired={codeRequired} />
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-navy-900/60">
              Registration is currently by invitation. Please contact your Ziora
              relationship manager to request access.
            </p>
          )}

          <p className="mt-6 text-center text-sm text-navy-900/60">
            Already have access?{" "}
            <Link href="/login" className="link-underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
