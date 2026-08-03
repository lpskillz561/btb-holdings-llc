// The house knowledge base, loaded from ./knowledge/*.md and prepended to the
// system prompt of every AI surface.
//
// Why a file rather than a string constant in ai.ts: the content is business
// knowledge, not code. It is transcribed from `docs/`, it changes when the deal
// changes, and it should be editable by whoever owns the deal without touching
// TypeScript. Every `.md` in ./knowledge is loaded in filename order, so
// extending the house view is adding a file, not editing a prompt.
//
// `docs/` itself is deliberately absent from git and from the deploy tarball —
// it is client legal and tax material. SKILL.md is the deployable substitute:
// it carries what those documents say so that a server that has never seen the
// PDFs still answers from them.
//
// This module reads from disk, so it is Node-only. Never import it from Edge
// middleware or a client component.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the knowledge lives, relative to the project root.
 *
 * `process.cwd()` is the project root in dev and the standalone root in the
 * container, and the two agree because `outputFileTracingIncludes` in
 * next.config.ts copies this directory into the standalone output under the
 * same relative path. Change one and you must change the other, or the build
 * ships without the knowledge and every AI answer quietly loses the deal.
 */
const KNOWLEDGE_DIR = join(process.cwd(), "src", "lib", "crm", "knowledge");

let cached: string | null = null;

/**
 * The concatenated knowledge base.
 *
 * Read once and held for the life of the process. Editing a knowledge file is a
 * redeploy, the same as editing any other part of the prompt — the alternative
 * is a disk read on every turn of every conversation to pick up a change nobody
 * makes at runtime.
 *
 * **Throws if the knowledge is missing**, and that is deliberate. The failure
 * this guards against is not an outage; it is the model answering fluently from
 * its own priors about "tiny home tax strategies" — describing a 7-day §469
 * deal, or a non-recourse note, or land the client owns. That is a deal BTB does
 * not sell, in prose that goes to a taxpayer and their CPA. Refusing is the
 * safer failure, and it surfaces as a plain 500 on the AI routes only.
 */
export function loadSkill(): string {
  if (cached !== null) return cached;

  let files: string[];
  try {
    files = readdirSync(KNOWLEDGE_DIR)
      .filter((name) => name.endsWith(".md"))
      .sort();
  } catch (err) {
    throw new Error(
      `The AI knowledge base is missing: could not read ${KNOWLEDGE_DIR}. ` +
        `Check outputFileTracingIncludes in next.config.ts — the build must copy ` +
        `src/lib/crm/knowledge into the standalone output. (${String(err)})`,
    );
  }

  if (!files.length) {
    throw new Error(`The AI knowledge base is empty: no .md files in ${KNOWLEDGE_DIR}.`);
  }

  cached = files
    .map((name) => readFileSync(join(KNOWLEDGE_DIR, name), "utf8").trim())
    .join("\n\n---\n\n");

  return cached;
}

/** Whether the knowledge loads at all. For the health/diagnostic surfaces. */
export function skillStatus(): { ok: boolean; files: number; chars: number; error?: string } {
  try {
    const text = loadSkill();
    const files = readdirSync(KNOWLEDGE_DIR).filter((n) => n.endsWith(".md")).length;
    return { ok: true, files, chars: text.length };
  } catch (err) {
    return { ok: false, files: 0, chars: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
