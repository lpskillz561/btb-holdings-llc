// Browser-side calls into /api/crm.
//
// Every endpoint answers errors as `{ error }` with a meaningful status, so the
// single job here is to surface that message to the user rather than a bare
// "Failed to fetch" — a 403 from the CRM allow-list and a 503 from a missing
// OPENAI_API_KEY both need to be readable on screen to be actionable.

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

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
