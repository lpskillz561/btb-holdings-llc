// "What shipped" email.
//
//   DATABASE_URL=… OPENAI_API_KEY=… node digest.mjs
//   DRY_RUN=1 node digest.mjs      # render and print, send nothing
//
// SILENCE IS THE DEFAULT. This job sends nothing at all unless a deploy has
// happened since the last run AND that deploy contained something a user would
// notice. Most days that is nothing, and on those days nobody gets an email.
// A digest that arrives every morning saying "no changes" is the thing people
// filter, and once filtered the one that matters is filtered too.
//
// SHIPPED MEANS DEPLOYED, NOT COMMITTED. The two are different here and the
// difference has already caused confusion: a rename was committed and pushed
// and stayed invisible for an hour because nothing had deployed. So the input
// is release manifests written by scripts/ship-app.sh at DEPLOY time, not
// `git log`. The app tarball excludes .git, so the server has no commit
// history of its own; the manifests are how it learns what went out.
//
// NEVER ANNOUNCE THE SAME THING TWICE. Three independent guards, because the
// user-visible cost of a repeat is that people stop reading:
//
//   1. A release is processed once. Its SHA goes in crm_release_log.
//   2. The model is shown everything announced in the last 120 days and told
//      to skip anything already covered, and anything that is only a follow-up
//      fix to something already covered.
//   3. Every item carries a stable `key`, and that key is the PRIMARY KEY of
//      crm_announcements. Even if the model ignores rule 2, the insert
//      conflicts and the item is dropped before it can be sent. This is the
//      guard that does not depend on the model behaving.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { renderDigest, renderText, sendDigest } from "./lib/digestMail.mjs";

const run = promisify(execFile);
const { Client } = pg;

const BUCKET = process.env.DEPLOY_BUCKET || "btb-crm-deploy-761540266321";
const REGION = "us-east-1";
const DRY_RUN = process.env.DRY_RUN === "1";
/** How far back the model is shown, to avoid re-announcing. */
const MEMORY_DAYS = Number(process.env.DIGEST_MEMORY_DAYS || 120);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS crm_release_log (
  sha          text PRIMARY KEY,
  shipped_at   timestamptz,
  processed_at timestamptz NOT NULL DEFAULT now(),
  item_count   int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS crm_announcements (
  -- The model's stable slug for the FEATURE, not for the commit. This being
  -- the primary key is what makes a repeat impossible rather than unlikely.
  key           text PRIMARY KEY,
  title         text NOT NULL,
  summary       text NOT NULL,
  release_sha   text,
  recipients    int NOT NULL DEFAULT 0,
  announced_at  timestamptz NOT NULL DEFAULT now()
);`;

/* -------------------------------------------------------------------------- */
/* Releases                                                                    */
/* -------------------------------------------------------------------------- */

async function listReleaseKeys() {
  const { stdout } = await run("aws", [
    "s3", "ls", `s3://${BUCKET}/releases/`, "--region", REGION,
  ]).catch(() => ({ stdout: "" }));
  return stdout
    .split("\n")
    .map((l) => l.trim().split(/\s+/).pop())
    .filter((f) => f && f.endsWith(".json"));
}

async function readRelease(file) {
  const { stdout } = await run("aws", [
    "s3", "cp", `s3://${BUCKET}/releases/${file}`, "-", "--region", REGION,
  ]);
  return JSON.parse(stdout);
}

/* -------------------------------------------------------------------------- */
/* Recipients                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Everyone who can actually USE the CRM.
 *
 * Both kinds of account, because there are two: `portal_users` rows and the
 * built-ins in AUTH_USERS, which are not rows at all. Blocked accounts are
 * excluded — they cannot sign in, so telling them about a feature is noise.
 *
 * CRM_ADMINS is the access allow-list and is respected here for the same
 * reason: a registered account without CRM access gets a 404 on every page, so
 * announcing features to it describes something the reader cannot reach.
 * Unset means everyone signed in has access, which is the documented default.
 */
async function recipients(client) {
  const { rows } = await client.query(
    "SELECT email FROM portal_users WHERE blocked_at IS NULL AND email IS NOT NULL",
  );
  const all = new Set(rows.map((r) => r.email.trim().toLowerCase()).filter(Boolean));
  for (const pair of (process.env.AUTH_USERS || "").split(",")) {
    const email = pair.split(":")[0]?.trim().toLowerCase();
    if (email) all.add(email);
  }
  const allow = (process.env.CRM_ADMINS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const list = allow.length ? [...all].filter((e) => allow.includes(e)) : [...all];
  return list.sort();
}

/* -------------------------------------------------------------------------- */
/* The model                                                                   */
/* -------------------------------------------------------------------------- */

const ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string" },
          tag: { type: "string", enum: ["New", "Improved", "Fixed"] },
          title: { type: "string" },
          what: { type: "string" },
          how: { type: "string" },
        },
        required: ["key", "tag", "title", "what", "how"],
      },
    },
  },
  required: ["items"],
};

const SYSTEM = `You write the "what shipped" email for the BTB Holdings CRM, an internal tool used by a small property team. Your readers are not engineers. They are the people who use the CRM to manage clients, proposals, contracts and land.

You are given commit messages from one or more deploys, and a list of everything already announced. Return the changes worth telling those readers about — and NOTHING else.

RETURN AN EMPTY LIST RATHER THAN PADDING. Most deploys contain nothing a user would notice. An empty list is the correct, common answer and causes no email to be sent. Never invent a change to have something to say.

EXCLUDE, always:
- Refactors, renames, type changes, dependency bumps, build or CI work.
- Infrastructure: deploys, DNS, IAM, schema migrations, timers, scripts.
- Documentation and comments.
- Fixes to code that was never released, or to a bug introduced and fixed between deploys.
- Anything already in the "already announced" list.
- Anything that is only a follow-up, fix or tweak to something in that list. If zoning was announced, a later fix to the zoning importer is NOT a new item.

MERGE related commits. Several commits building one feature are ONE item, described as the finished thing. Never one item per commit.

For each item you do return:
- key: a stable lowercase slug for the FEATURE, e.g. "zoning-on-land-search". It must be the slug you would pick for this feature no matter which commit introduced it, because it is used to prevent re-announcing. Never include a date or a commit id.
- tag: "New" for a capability that did not exist, "Improved" for something better, "Fixed" for a user-visible bug that was hurting people.
- title: a short plain sentence. No jargon, no file names, no function names.
- what: 1-2 sentences on what it is and why it matters to their work. Plain English. Never mention code, commits, tables or columns.
- how: concrete steps to use it, naming what they click. Refer to real navigation: the left sidebar has Overview, Board, Proposals, Contracts, Our land, Holdings, Financials. You may use <b> for emphasis.

Write calmly and specifically. No marketing voice, no exclamation marks, no "we're excited".`;

async function chooseItems(commits, announced) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required.");
  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";

  const user = [
    "COMMITS IN THIS DEPLOY:",
    ...commits.map((c) => `- ${c.subject}\n${(c.body || "").trim().split("\n").slice(0, 12).join("\n")}`),
    "",
    "ALREADY ANNOUNCED (never repeat these, and never announce follow-ups to them):",
    announced.length
      ? announced.map((a) => `- [${a.key}] ${a.title} — ${a.summary}`).join("\n")
      : "(nothing yet)",
  ].join("\n");

  // No temperature: newer models reject any non-default value with a 400 that
  // takes the whole request with it.
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "digest", strict: true, schema: ITEM_SCHEMA },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = await res.json();
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content.");
  const parsed = JSON.parse(content);
  return Array.isArray(parsed.items) ? parsed.items : [];
}

/* -------------------------------------------------------------------------- */

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(SCHEMA);

    const files = await listReleaseKeys();
    if (files.length === 0) {
      console.log("[digest] no release manifests in S3 — nothing has shipped through ship-app.sh yet.");
      return;
    }
    const { rows: done } = await client.query("SELECT sha FROM crm_release_log");
    const seen = new Set(done.map((r) => r.sha));

    const pending = [];
    for (const f of files) {
      const sha = f.replace(/\.json$/, "");
      if (seen.has(sha)) continue;
      pending.push(await readRelease(f));
    }
    if (pending.length === 0) {
      console.log("[digest] no new deploys since the last run. Nothing to send.");
      return;
    }
    const commits = pending.flatMap((r) => r.commits ?? []);
    console.log(
      `[digest] ${pending.length} unannounced deploy(s), ${commits.length} commit(s)`,
    );
    if (commits.length === 0) {
      await markProcessed(client, pending, 0);
      console.log("[digest] those deploys carried no commits. Nothing to send.");
      return;
    }

    const { rows: announced } = await client.query(
      `SELECT key, title, summary FROM crm_announcements
        WHERE announced_at > now() - ($1 || ' days')::interval
        ORDER BY announced_at DESC LIMIT 200`,
      [String(MEMORY_DAYS)],
    );

    let items = await chooseItems(commits, announced);
    console.log(`[digest] model proposed ${items.length} item(s)`);

    // Guard 3: the model was told not to repeat; this makes it impossible.
    const { rows: existing } = await client.query("SELECT key FROM crm_announcements");
    const known = new Set(existing.map((r) => r.key));
    const dropped = items.filter((i) => known.has(i.key));
    items = items.filter((i) => !known.has(i.key));
    if (dropped.length) {
      console.log(
        `[digest] dropped ${dropped.length} already-announced: ${dropped.map((d) => d.key).join(", ")}`,
      );
    }

    if (items.length === 0) {
      await markProcessed(client, pending, 0);
      console.log("[digest] nothing user-visible in these deploys. No email sent — that is the normal case.");
      return;
    }

    const to = await recipients(client);
    if (to.length === 0) {
      console.log("[digest] no recipients with CRM access. Not marking processed, so this retries.");
      return;
    }

    const dateLabel = new Date().toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    });
    const html = renderDigest(items, dateLabel);
    const text = renderText(items, dateLabel);
    const subject =
      items.length === 1
        ? `What shipped — ${items[0].title}`
        : `What shipped — ${items[0].title}, and ${items.length - 1} more`;

    console.log(`[digest] sending to ${to.length} recipient(s)${DRY_RUN ? " (DRY RUN)" : ""}`);
    for (const i of items) console.log(`  • [${i.tag}] ${i.title}  (${i.key})`);

    const { sent, failed } = await sendDigest({ recipients: to, subject, html, text, dryRun: DRY_RUN });
    for (const f of failed) console.warn(`[digest] FAILED for ${f.to}: ${f.error}`);
    if (sent.length === 0) throw new Error("every send failed — not recording, so this retries");

    if (!DRY_RUN) {
      // After a successful send, so a send failure leaves the feature
      // unannounced and retryable rather than silently suppressed forever.
      for (const i of items) {
        await client.query(
          `INSERT INTO crm_announcements (key, title, summary, release_sha, recipients)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO NOTHING`,
          [i.key, i.title, i.what, pending[pending.length - 1]?.sha ?? null, sent.length],
        );
      }
      await markProcessed(client, pending, items.length);
    }
    console.log(`[digest] sent ${sent.length}, failed ${failed.length}`);
  } finally {
    await client.end();
  }
}

async function markProcessed(client, releases, itemCount) {
  for (const r of releases) {
    await client.query(
      `INSERT INTO crm_release_log (sha, shipped_at, item_count) VALUES ($1,$2,$3)
       ON CONFLICT (sha) DO NOTHING`,
      [r.sha, r.shipped_at ?? null, itemCount],
    );
  }
}

main().catch((err) => {
  console.error(`[digest] FAILED: ${err.message}`);
  process.exitCode = 1;
});
