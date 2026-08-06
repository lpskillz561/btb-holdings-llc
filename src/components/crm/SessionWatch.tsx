"use client";

/**
 * Says "you have been signed out" once, plainly, when it becomes true.
 *
 * This exists because of a real report. A card was opened after the tab had sat
 * idle past the 8-hour session TTL; the page itself had been rendered while the
 * session was still good, so the board looked entirely normal, and the only
 * symptom was the words "Not authorized." inside the comment box. Which reads as
 * "comments are broken", not as "you are logged out" — and the subtask and tag
 * loads were failing at exactly the same moment while swallowing their errors,
 * so nothing else on screen contradicted that reading.
 *
 * Mounted from app/crm/layout.tsx so it survives navigation, and driven by a
 * window event from components/crm/api.ts rather than by polling: the truth is
 * discovered by whichever fetch happens to run, and there is no point asking the
 * server on a timer whether a cookie has expired.
 *
 * It does NOT auto-redirect. Being thrown to a login screen would discard a
 * half-written comment or a form somebody had been filling in for ten minutes,
 * and the whole reason this is being shown is that they were mid-task. The link
 * carries `?next=` so signing in returns them to the page they were on.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SESSION_EXPIRED_EVENT } from "./api";
import { isClientFacingRoute } from "@/lib/crm/routes";

export function SessionWatch() {
  const [expired, setExpired] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onExpired = () => setExpired(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // Same rule as the rest of the app furniture: nothing of ours on a print page
  // or on the presentation deck. See lib/crm/routes.ts.
  if (!expired || isClientFacingRoute(pathname)) return null;

  return (
    <div
      role="alert"
      className="animate-pop-in fixed inset-x-0 bottom-0 z-[70] border-t border-warn-500/40 bg-warn-50 px-4 py-3 shadow-pop"
    >
      <div className="container-x flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 text-sm text-warn-700">
          <span className="font-semibold">You have been signed out.</span> This page was loaded
          while you were still signed in, so what you can see is still here — but nothing will
          save until you sign in again.
        </p>
        {/* A full navigation, not a router push: the session cookie is gone, so
            the point is to leave the client-side app entirely. `next=` brings
            them back to the page they were on. */}
        <a
          href={`/login?next=${encodeURIComponent(pathname)}`}
          className="sf-btn-brand shrink-0"
        >
          Sign in again
        </a>
      </div>
    </div>
  );
}
