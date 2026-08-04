// The "what shipped" email: template, recipients, and sending.
//
// Table-based HTML with inline styles, because Gmail strips <style> blocks and
// Outlook ignores most modern CSS. 600px is the widest that survives a phone
// without horizontal scrolling.
//
// Sent through the AWS CLI rather than an SDK: the CLI is already on the host,
// the instance role already carries a From-scoped ses:SendEmail policy, and
// adding @aws-sdk/client-sesv2 to this repo would be a dependency for one call.

import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

const FROM = "BTB Holdings CRM <notifications@btbholdingsllc.com>";
// Replies go to the Google Workspace inbox. The sending domain is
// btbholdingsllc.com because ziora.io's DNS is on Cloudflare, not Route53 -
// see CLAUDE.md in the app repo before trying to change this.
const REPLY_TO = "info@ziora.io";
const REGION = "us-east-1";

const NAVY = "#0a1430";
const GOLD = "#c8a45c";
const INK = "#181818";
const MUTED = "#5c5c5c";
const LINE = "#e5e5e5";

const esc = (s) =>
  String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

/**
 * `what` and `how` are model-written prose. They are escaped, then a very small
 * allow-list of formatting is put back: <b> and <i> only. Anything else the
 * model emits stays visible as text rather than becoming markup in a message
 * going to every member of staff.
 */
function richText(s) {
  return esc(s)
    .replace(/&lt;(\/?)(b|i)&gt;/g, "<$1$2>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

export function renderDigest(items, dateLabel) {
  const rows = items
    .map(
      (it) => `
        <tr><td style="padding:0 0 28px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr><td style="padding:0 0 6px 0;">
              <span style="display:inline-block;background:${NAVY};color:#ffffff;font-size:11px;
                     letter-spacing:.08em;text-transform:uppercase;padding:4px 9px;border-radius:3px;
                     font-family:Helvetica,Arial,sans-serif;">${esc(it.tag)}</span>
            </td></tr>
            <tr><td style="font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1.3;
                   color:${INK};padding:0 0 8px 0;font-weight:600;">${esc(it.title)}</td></tr>
            <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;
                   color:${MUTED};padding:0 0 12px 0;">${richText(it.what)}</td></tr>
            <tr><td style="background:#f7f7f5;border-left:3px solid ${GOLD};padding:12px 14px;
                   font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:${INK};">
                   <strong style="color:${NAVY};">How to use it&nbsp;&rarr;</strong> ${richText(it.how)}</td></tr>
          </table>
        </td></tr>`,
    )
    .join("");

  const more = items.length - 1;
  const preheader =
    items.length === 1
      ? esc(items[0].title)
      : `${esc(items[0].title)} — and ${more} more change${more === 1 ? "" : "s"} in the CRM.`;

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f2;">
<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f2;">
 <tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
         style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:6px;">
   <tr><td style="background:${NAVY};padding:22px 32px;border-radius:6px 6px 0 0;">
     <div style="font-family:Georgia,serif;font-size:19px;color:#ffffff;letter-spacing:.02em;">BTB Holdings</div>
     <div style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${GOLD};
            letter-spacing:.16em;text-transform:uppercase;padding-top:5px;">What shipped &middot; ${esc(dateLabel)}</div>
   </td></tr>
   <tr><td style="padding:30px 32px 6px 32px;">
     <p style="margin:0 0 26px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;
        line-height:1.6;color:${MUTED};">Here is what changed in the CRM, and what each one means for you.</p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
   </td></tr>
   <tr><td style="padding:4px 32px 30px 32px;">
     <a href="https://btbholdingsllc.com/crm" style="display:inline-block;background:${NAVY};color:#ffffff;
        font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;
        padding:12px 22px;border-radius:4px;">Open the CRM</a>
   </td></tr>
   <tr><td style="border-top:1px solid ${LINE};padding:18px 32px 22px 32px;
          font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8a8a8a;">
     You are receiving this because you have access to the BTB Holdings CRM.<br>
     Replies go to <a href="mailto:${REPLY_TO}" style="color:${MUTED};">${REPLY_TO}</a>.
   </td></tr>
  </table>
 </td></tr></table></body></html>`;
}

/** The same content as plain text. Some clients never render the HTML part. */
export function renderText(items, dateLabel) {
  const strip = (s) => String(s ?? "").replace(/<\/?[bi]>/g, "").replace(/\*\*/g, "");
  return (
    `BTB Holdings CRM — what shipped, ${dateLabel}\n\n` +
    items
      .map((it) => `${it.tag.toUpperCase()}: ${it.title}\n${strip(it.what)}\n\nHow to use it: ${strip(it.how)}`)
      .join("\n\n---\n\n") +
    `\n\nOpen the CRM: https://btbholdingsllc.com/crm\nReplies go to ${REPLY_TO}.\n`
  );
}

/**
 * Send to everyone, one message each.
 *
 * Individually addressed rather than one message with everyone in To or BCC:
 * a staff list in a visible To header is a small leak, and a single BCC blast
 * means one bad address can affect delivery for the whole batch. SES is rated
 * at 14/sec, so a handful of staff is nowhere near any limit.
 */
export async function sendDigest({ recipients, subject, html, text, dryRun = false }) {
  const sent = [];
  const failed = [];
  for (const to of recipients) {
    const payload = {
      FromEmailAddress: FROM,
      ReplyToAddresses: [REPLY_TO],
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: html, Charset: "UTF-8" },
            Text: { Data: text, Charset: "UTF-8" },
          },
        },
      },
    };
    if (dryRun) {
      sent.push({ to, messageId: "DRY-RUN" });
      continue;
    }
    // Via a file: the payload is far past any safe argv length.
    const path = `/tmp/digest-${Date.now()}-${Math.abs(hash(to))}.json`;
    try {
      await writeFile(path, JSON.stringify(payload));
      const { stdout } = await run("aws", [
        "sesv2", "send-email",
        "--cli-input-json", `file://${path}`,
        "--region", REGION,
        "--query", "MessageId", "--output", "text",
      ]);
      sent.push({ to, messageId: stdout.trim() });
    } catch (err) {
      // One bad address must not stop the rest of the send.
      failed.push({ to, error: String(err.message ?? err).slice(0, 200) });
    } finally {
      await unlink(path).catch(() => {});
    }
  }
  return { sent, failed };
}

/** Small stable hash, only used to keep temp filenames distinct. */
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
