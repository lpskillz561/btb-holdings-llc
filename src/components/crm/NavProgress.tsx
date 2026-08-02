"use client";

/**
 * The thin bar across the top of the window while a section is loading.
 *
 * This exists so that `app/crm/loading.tsx` does not have to. A `loading.tsx`
 * is a Suspense fallback: the moment you click, React throws the page you were
 * reading away and puts a grey skeleton in its place, and on a slow dynamic
 * render that reads as the window going blank — which it is, structurally. With
 * no loading boundary anywhere under /crm, the router holds the current page on
 * screen for the whole round trip and swaps it for the finished one, so there
 * is never an in-between state to look at.
 *
 * What that costs is the thing the skeleton was added for: next/link calls
 * preventDefault(), which suppresses the browser's own loading indicator, so a
 * three-second render with nothing on screen to show for it reads as a dead
 * link. This is that indicator, and it has to be at least as trustworthy as the
 * skeleton was — which means covering EVERY navigation, not just the section
 * tabs. Hence a capture-phase click listener on the document rather than
 * useLinkStatus: breadcrumbs, table rows, stat cards and the back button all
 * get the same feedback.
 */

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

/** Give up and hide rather than sit at 92% forever if a navigation is lost. */
const STALL_MS = 20_000;

/**
 * Navigations that resolve faster than this show nothing at all. Most clicks in
 * the CRM are served from the router cache, and a bar that appears and completes
 * inside 80ms is a flicker — noise reading as an error.
 */
const SHOW_AFTER_MS = 120;

/** How long the completed bar takes to run out and fade. Matches the CSS. */
const DONE_MS = 400;

function NavProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Search params count: the land-search filters change the query and nothing
  // else, and that is still a navigation the user is waiting on.
  const key = `${pathname}?${searchParams}`;

  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const pending = useRef(false);
  const landed = useRef(key);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  const finish = useCallback(() => {
    clearTimers();
    const wasVisible = pending.current;
    pending.current = false;
    // Nothing was ever painted, so there is nothing to run out — go quiet.
    if (!wasVisible) {
      setPhase("idle");
      return;
    }
    setPhase("done");
    timers.current.push(window.setTimeout(() => setPhase("idle"), DONE_MS));
  }, []);

  const start = useCallback(() => {
    clearTimers();
    setPhase("idle");
    timers.current.push(
      window.setTimeout(() => {
        pending.current = true;
        setPhase("loading");
      }, SHOW_AFTER_MS),
    );
    timers.current.push(window.setTimeout(finish, STALL_MS));
  }, [finish]);

  // Arrival. The pathname only changes once the router has the new page in
  // hand, which — with no Suspense boundary to trip first — is exactly the
  // moment the wait is over.
  useEffect(() => {
    if (landed.current === key) return;
    landed.current = key;
    finish();
  }, [key, finish]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;

      const url = new URL(anchor.href, window.location.href);
      // Another origin, or /api/auth/logout: the browser does a real page load
      // and shows its own indicator, so ours would only ever be a duplicate.
      if (url.origin !== window.location.origin) return;
      if (!url.pathname.startsWith("/crm")) return;
      // A link to where we already are never fires a pathname change, so the
      // bar would have nothing to end it.
      if (url.pathname + url.search === window.location.pathname + window.location.search) {
        return;
      }

      start();
    }

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", start);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", start);
      clearTimers();
    };
  }, [start]);

  if (phase === "idle") return null;

  return (
    <div
      className={`nav-progress ${phase === "done" ? "nav-progress--done" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="nav-progress__bar" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function NavProgress() {
  // useSearchParams suspends, and this sits in the layout above every page.
  return (
    <Suspense fallback={null}>
      <NavProgressInner />
    </Suspense>
  );
}
