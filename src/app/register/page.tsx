import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { AuthShell } from "@/components/AuthShell";
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
  // Registering does NOT grant CRM access. This used to be "/crm", so a new
  // user finished the form and was shown a 404 — see app/welcome/page.tsx.
  return "/welcome";
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
    <AuthShell>
      <p className="bg-grad-ai bg-clip-text text-xs font-bold uppercase tracking-[0.18em] text-transparent">
        Request access
      </p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink-900">
        Create your account
      </h1>

      {open ? (
        <>
          <p className="mt-2 text-sm text-ink-600">
            Set up access to the Ziora underwriting platform.
          </p>
          <div className="mt-7">
            <RegisterForm next={dest} codeRequired={codeRequired} />
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-600">
          Registration is currently by invitation. Please contact your Ziora relationship
          manager to request access.
        </p>
      )}

      <p className="mt-6 text-center text-sm text-ink-600">
        Already have access?{" "}
        <Link href="/login" className="font-medium text-sf-600 underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
