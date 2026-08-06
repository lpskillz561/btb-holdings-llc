// Browser-side calls into /api/crm.
//
// Every endpoint answers errors as `{ error }` with a meaningful status, so the
// single job here is to surface that message to the user rather than a bare
// "Failed to fetch" — a 403 from the CRM allow-list and a 503 from a missing
// OPENAI_API_KEY both need to be readable on screen to be actionable.

/**
 * Fired on the window the first time any call comes back 401.
 *
 * A session expires while a tab sits open — the TTL is 8 hours — and every
 * client-side fetch then fails at once. Handled per-call, that surfaces as a raw
 * "Not authorized." inside whichever widget happened to ask first, which reads
 * as that widget being broken rather than as "you have been signed out". The
 * event lets one component in the layout say the true thing once.
 */
export const SESSION_EXPIRED_EVENT = "crm:session-expired";

/** Thrown on 401 so a caller can tell "signed out" from "that failed". */
export class SessionExpiredError extends Error {
  constructor() {
    super("Your session has expired. Sign in again to carry on.");
    this.name = "SessionExpiredError";
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  // FormData is passed through UNTOUCHED, and in particular without a
  // Content-Type. `multipart/form-data` is only parseable with the boundary
  // token appended to it, the browser generates that token when it serialises
  // the body, and setting the header by hand omits it — which the server sees
  // as a malformed body rather than as a missing header. Letting fetch write
  // this one header is the whole trick.
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(url, {
    method,
    headers: body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });

  // 401 means the cookie is gone or stale, and it is never specific to the
  // thing that was being fetched. Announce it globally and throw a recognisable
  // error rather than letting "Not authorized." land in a comment box.
  //
  // 403 is deliberately NOT treated this way: that one IS about the caller —
  // signed in, but not on the CRM allow-list — and its message is worth reading
  // where it happened.
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    throw new SessionExpiredError();
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON — an HTML error page from an upstream proxy, most likely.
  }

  if (!res.ok) {
    const message =
      (payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : "") || `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

export const apiGet = <T,>(url: string) => request<T>("GET", url);
export const apiPost = <T,>(url: string, body?: unknown) => request<T>("POST", url, body ?? {});
export const apiPatch = <T,>(url: string, body: unknown) => request<T>("PATCH", url, body);
export const apiDelete = (url: string) => request<void>("DELETE", url);

/** POST a file. The only call in the app that is not JSON. */
export const apiUpload = <T,>(url: string, form: FormData) => request<T>("POST", url, form);

/**
 * DELETE that answers with a body.
 *
 * Most deletes here return 204, which is why `apiDelete` is typed `void`.
 * Detaching a tag from a card is the exception: it returns the card's REMAINING
 * tags, so the dialog re-renders from the server's answer rather than
 * reconstructing the set by filtering its own state — which is how a set drifts
 * when two people edit the same card.
 */
export const apiDeleteJson = <T,>(url: string) => request<T>("DELETE", url);

/** Build a query string, dropping empty values so blank inputs don't filter. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
