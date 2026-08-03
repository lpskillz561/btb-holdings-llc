// Bounded HTTP for the ETL.
//
// Every source this thing reads is a public county or state GIS endpoint on the
// far side of the internet. The failure that cost a full afternoon was not one
// of them returning an error — it was one of them going *silent*. A bare
// `fetch()` carries no deadline, so the MT import sat inside a single request
// for two hours with its upstream socket already gone, holding an open
// `COPY parcels_staging` and its lock, which blocked every other import behind
// it and left the table unreadable.
//
// Two rules follow, and both are load-bearing:
//
//  1. **Every request carries a deadline, and the deadline covers the BODY.**
//     `fetch()` resolves as soon as the response headers land, so a timeout
//     wrapped around the `fetch()` call alone still lets `await res.json()` hang
//     forever on a body that stops arriving mid-stream. Passing the signal into
//     `fetch` and reading the body while it is still armed is what closes that
//     gap — it is the difference between a timeout that works and one that
//     looks like it does.
//  2. **A caller can pass its own signal**, so the stall watchdog in import.mjs
//     can cancel a request that is technically still inside its own deadline.
//
// Node 18 has no `AbortSignal.any()`, so the two signals are combined by hand.

const DEFAULT_TIMEOUT_MS = Number(process.env.ETL_HTTP_TIMEOUT_MS || 90_000);
const DEFAULT_ATTEMPTS = Number(process.env.ETL_HTTP_ATTEMPTS || 4);

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * One controller that fires if EITHER the caller's signal aborts or the
 * deadline passes. `dispose()` must run once the body has been read, not once
 * the headers have — see rule 1.
 */
function armGuard(parent, timeoutMs) {
  const ac = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort(new Error(`no response within ${timeoutMs}ms`));
  }, timeoutMs);

  const onParentAbort = () => ac.abort(parent.reason);
  if (parent) {
    if (parent.aborted) ac.abort(parent.reason);
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }

  return {
    signal: ac.signal,
    get timedOut() {
      return timedOut;
    },
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

/** Transport-level failures worth another go: resets, DNS blips, refused. */
function isNetworkError(err) {
  if (err?.name === "TypeError") return true; // undici wraps transport errors
  const code = err?.cause?.code ?? err?.code;
  return (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "UND_ERR_SOCKET" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT"
  );
}

async function request(url, opts, read) {
  const {
    init = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    attempts = DEFAULT_ATTEMPTS,
    label = url,
    signal: parent,
    log = console.log,
  } = opts ?? {};

  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const guard = armGuard(parent, timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: guard.signal });
      if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
      // Still inside the guard: a body that stalls half-delivered aborts too.
      return await read(res);
    } catch (err) {
      lastErr = err;

      // The caller pulled the plug — the watchdog fired, or the run is being
      // torn down. Retrying would be arguing with it.
      if (parent?.aborted) {
        throw new Error(`${label} cancelled: ${parent.reason?.message ?? "aborted"}`);
      }

      const status = err instanceof HttpError ? err.status : 0;
      const retryable =
        guard.timedOut || status === 429 || status >= 500 || isNetworkError(err);

      if (!retryable || attempt === attempts) {
        throw new Error(
          `${label} failed after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${err.message}`,
          { cause: err },
        );
      }

      const backoff = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      log(`  retry ${attempt}/${attempts - 1} for ${label} (${err.message}) after ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
    } finally {
      guard.dispose();
    }
  }
  throw lastErr;
}

/** GET and parse JSON, with a deadline over the whole exchange. */
export function fetchJson(url, opts) {
  return request(url, opts, (res) => res.json());
}

/** GET into a Buffer, with a deadline over the whole exchange. */
export function fetchBuffer(url, opts) {
  return request(url, opts, async (res) => Buffer.from(await res.arrayBuffer()));
}
