// Stateless session tokens for the platform (/app) gate.
//
// The token is an HMAC-SHA256-signed `payload.signature` string (a tiny JWT-ish
// format). We use the Web Crypto API rather than Node's `crypto` so the exact
// same code runs in BOTH the Edge runtime (middleware verifies the cookie) and
// the Node runtime (the login route signs it). No database or session store is
// needed — the signature is the proof.

const encoder = new TextEncoder();

/** Name of the HTTP-only cookie that carries the signed session. */
export const SESSION_COOKIE = "ziora_session";

/** How long a session stays valid (seconds). */
export const SESSION_TTL = 60 * 60 * 8; // 8 hours

/**
 * Signing secret. Required in production. In development we fall back to a fixed
 * dev-only value so `next dev` works out of the box — it is NEVER used when
 * NODE_ENV is "production" (auth would be trivially forgeable otherwise).
 */
function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length > 0) return secret;
  if (process.env.NODE_ENV !== "production") {
    return "dev-insecure-secret-do-not-use-in-production";
  }
  throw new Error(
    "AUTH_SECRET is not set — the platform login cannot sign sessions.",
  );
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  // Back the array with a concrete ArrayBuffer so it satisfies BufferSource
  // (crypto.subtle) under TS strict lib typings.
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function importKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface SessionPayload {
  /** Authenticated user (email). */
  sub: string;
  /** Display name, when the account has one (registered users). */
  name?: string;
  /** Issued-at (unix seconds). */
  iat: number;
  /** Expiry (unix seconds). */
  exp: number;
}

/** Sign a new session token for the given user. */
export async function createSessionToken(sub: string, name?: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const trimmed = name?.trim();
  const payload: SessionPayload = { sub, iat: now, exp: now + SESSION_TTL };
  if (trimmed) payload.name = trimmed;
  const payloadB64 = base64url(encoder.encode(JSON.stringify(payload)));
  const key = await importKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payloadB64),
  );
  return `${payloadB64}.${base64url(sig)}`;
}

/**
 * Verify a session token. Returns the payload if the signature is valid and the
 * token has not expired, otherwise null. Never throws on malformed input.
 */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  let valid = false;
  try {
    const key = await importKey();
    valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64urlToBytes(sigB64),
      encoder.encode(payloadB64),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(base64urlToBytes(payloadB64)),
    );
  } catch {
    return null;
  }

  if (
    typeof payload.exp !== "number" ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return payload;
}
