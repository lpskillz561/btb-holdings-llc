// The Recall.ai adapter — the ONLY place that knows a bot vendor exists.
//
// Everything else in the CRM deals in `crm_meetings` rows. That was the point of
// building Phase 1 source-agnostic: swapping vendors, or adding a second one,
// should be this file plus a `source` value, not a change to the calendar, the
// client card or the summariser.
//
// Recall's API is region-scoped: a key issued in one workspace does not
// authenticate against another region's host, and the failure reads as a bad key
// rather than a wrong host. `RECALL_REGION` must match where the account was
// created.
//
// API shape verified against docs.recall.ai (August 2026):
//   POST /api/v1/bot                                  create a bot
//   POST /api/v1/recording/{id}/create_transcript/    start async transcription
//   GET  /api/v1/transcript/{id}/                     poll for the download URL
// Auth is `Authorization: Token <key>`.

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

/** Regions Recall serves. A key belongs to exactly one. */
const REGIONS = ["us-east-1", "us-west-2", "eu-central-1", "ap-northeast-1"] as const;

export function isRecallConfigured(): boolean {
  return Boolean(process.env.RECALL_API_KEY);
}

function apiKey(): string {
  const key = process.env.RECALL_API_KEY;
  if (!key) {
    throw new Error(
      "RECALL_API_KEY is not set. Add it under /btb-crm/ in SSM to enable the meeting notetaker.",
    );
  }
  return key;
}

function baseUrl(): string {
  const region = (process.env.RECALL_REGION ?? "us-east-1").trim();
  if (!(REGIONS as readonly string[]).includes(region)) {
    // Loud rather than silent: a bad region produces 401s that look exactly like
    // a bad key, and someone would spend the afternoon rotating a good one.
    throw new Error(
      `RECALL_REGION "${region}" is not one of ${REGIONS.join(", ")}. It must match the region the Recall workspace was created in.`,
    );
  }
  return `https://${region}.recall.ai/api/v1`;
}

/**
 * What the bot calls itself in the participant list.
 *
 * The client sees this. It is deliberately configurable and deliberately
 * obvious — a bot that joins under an ambiguous name is the thing that makes
 * people uncomfortable, and an unexplained participant in a call about
 * someone's tax position is worse than none at all.
 */
export function notetakerName(): string {
  return process.env.RECALL_BOT_NAME?.trim() || "AI Notetaker";
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One call to Recall, with a deadline.
 *
 * The timeout is armed over the whole exchange rather than around `fetch`
 * alone: `fetch()` resolves at the response HEADERS, so a timeout that only
 * wraps the call still lets a stalled body hang forever. That exact failure
 * wedged a parcel import for two hours — see the ETL notes in CLAUDE.md.
 */
async function call<T>(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Token ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // The body carries Recall's own validation message ("meeting_url is not a
      // supported platform", and so on), which is the useful part. Truncated, so
      // an HTML error page cannot become the error message.
      throw new Error(`Recall ${res.status}: ${text.slice(0, 400)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

export interface RecallBot {
  id: string;
  meeting_url?: unknown;
  status_changes?: { code: string; created_at: string }[];
}

/**
 * Send the notetaker into a call.
 *
 * `recallai_async` rather than the streaming provider: Phase 2 wants an accurate
 * post-call transcript, not a live feed. Live transcription is Phase 3 and is a
 * different provider plus a realtime endpoint on this same request — which is
 * why this integration was worth doing before the live panel rather than after.
 */
export async function sendNotetaker(meetingUrl: string): Promise<RecallBot> {
  return call<RecallBot>("/bot", {
    method: "POST",
    body: {
      meeting_url: meetingUrl,
      bot_name: notetakerName(),
      recording_config: {
        transcript: { provider: { recallai_async: { language_code: "auto" } } },
      },
    },
  });
}

/** Ask Recall to transcribe a finished recording. Returns once queued, not done. */
export async function requestTranscript(recordingId: string): Promise<{ id: string }> {
  return call<{ id: string }>(`/recording/${encodeURIComponent(recordingId)}/create_transcript/`, {
    method: "POST",
    body: {
      provider: { recallai_async: { language_code: "auto" } },
      // Separate audio streams per participant where the platform provides them.
      // Worth asking for: a summary that attributes a commitment to the wrong
      // side of the call is worse than one that names nobody.
      diarization: { use_separate_streams_when_available: true },
    },
  });
}

interface TranscriptArtifact {
  id: string;
  status?: { code?: string };
  data?: { download_url?: string };
}

/** The transcript record, which carries a short-lived download URL once ready. */
export async function getTranscript(transcriptId: string): Promise<TranscriptArtifact> {
  return call<TranscriptArtifact>(`/transcript/${encodeURIComponent(transcriptId)}/`);
}

/** One speaker's contiguous turn, as Recall returns it. */
interface TranscriptTurn {
  participant?: { name?: string | null; email?: string | null } | null;
  words?: { text?: string }[] | null;
}

/**
 * Fetch the transcript body and flatten it to readable text.
 *
 * The download URL is presigned and short-lived, so this is not something to
 * store and use later — fetch and flatten in one go.
 *
 * Word-level timings are dropped deliberately. The summariser reads this, and
 * per-word offsets are noise that costs prompt budget; what earns its place is
 * WHO said it, because "Points to check" has to be able to say the staff member
 * described the seven-day test, not merely that the phrase occurred.
 */
export async function downloadTranscriptPayload(downloadUrl: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(downloadUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`Recall transcript download ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Speaker-labelled plain text from Recall's turn/word JSON. Exported for testing. */
export function flattenTranscript(payload: unknown): string {
  if (!Array.isArray(payload)) return "";
  const lines: string[] = [];
  let lastSpeaker = "";
  for (const turn of payload as TranscriptTurn[]) {
    const text = (turn.words ?? [])
      .map((w) => w?.text ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const speaker = turn.participant?.name?.trim() || "Unknown speaker";
    // Consecutive turns by one person are joined rather than re-labelled, which
    // is how a person actually reads as speaking a paragraph.
    if (speaker === lastSpeaker) lines[lines.length - 1] += ` ${text}`;
    else {
      lines.push(`${speaker}: ${text}`);
      lastSpeaker = speaker;
    }
  }
  return lines.join("\n\n");
}

/** Attendees named in a transcript, for the meeting row. */
export function transcriptAttendees(payload: unknown): { name: string | null; email: string | null }[] {
  if (!Array.isArray(payload)) return [];
  const seen = new Map<string, { name: string | null; email: string | null }>();
  for (const turn of payload as TranscriptTurn[]) {
    const name = turn.participant?.name?.trim() || null;
    const email = turn.participant?.email?.trim() || null;
    const key = (email ?? name ?? "").toLowerCase();
    if (key && !seen.has(key)) seen.set(key, { name, email });
  }
  return [...seen.values()];
}

/* -------------------------------------------------------------------------- */
/* Webhook verification                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Authenticate an inbound webhook. Throws if it cannot be trusted.
 *
 * This endpoint is the one door into the CRM with no session behind it — /api is
 * outside the middleware matcher, and `withCrm` cannot help because a webhook
 * has no user. So it fails CLOSED in every direction: no secret configured means
 * nothing is accepted, rather than everything.
 *
 * Two schemes, because Recall delivers status webhooks through Svix and the
 * dashboard also allows a plain endpoint:
 *
 *   - Svix: `whsec_`-prefixed secret, headers svix-id / svix-timestamp /
 *     svix-signature, signature over "{id}.{timestamp}.{body}".
 *   - Static: any other secret, presented as a bearer token.
 *
 * Whichever is configured is the only one accepted — supporting both
 * simultaneously would mean the weaker one is always available.
 */
export async function verifyWebhook(
  rawBody: string,
  headers: Headers,
): Promise<void> {
  const secret = process.env.RECALL_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("RECALL_WEBHOOK_SECRET is not set; refusing every webhook.");
  }

  if (secret.startsWith("whsec_")) {
    await verifySvix(rawBody, headers, secret.slice("whsec_".length));
    return;
  }

  const presented = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!presented || !timingSafeEqual(presented, secret)) {
    throw new Error("Webhook rejected: bad or missing bearer secret.");
  }
}

async function verifySvix(rawBody: string, headers: Headers, secretB64: string): Promise<void> {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader) {
    throw new Error("Webhook rejected: missing Svix headers.");
  }

  // Replay window. Without it a captured delivery stays valid forever, and these
  // deliveries carry transcript content.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) {
    throw new Error("Webhook rejected: timestamp outside the five-minute window.");
  }

  const { createHmac } = await import("node:crypto");
  const expected = createHmac("sha256", Buffer.from(secretB64, "base64"))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  // The header carries space-separated "v1,<sig>" pairs; any one matching is a
  // pass, which is what makes secret rotation possible without dropped events.
  const offered = signatureHeader
    .split(" ")
    .map((part) => part.split(",")[1] ?? "")
    .filter(Boolean);
  if (!offered.some((sig) => timingSafeEqual(sig, expected))) {
    throw new Error("Webhook rejected: signature did not verify.");
  }
}

/** Constant-time compare, so a wrong secret leaks nothing through timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
