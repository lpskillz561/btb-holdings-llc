// What the assistant has been given to read.
//
// The house knowledge base — `src/lib/crm/knowledge/SKILL.md` — is in git,
// reviewed, and deployed with the app. This page is the other half: documents
// staff upload at runtime, the note the model writes on each, and the deliberate
// act of adopting one into the prompt. See lib/crm/knowledge-docs.ts for why
// that act is separate from the reading.
//
// It is under `/crm` because that is what gates it. The middleware matcher is
// `/crm/:path*`; a top-level `/knowledge` would be public, and what is on this
// page is whatever a counterparty last sent us.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KnowledgeLibrary } from "@/components/crm/KnowledgeLibrary";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { StatTile } from "@/components/crm/ui";
import { getCrmPageUser } from "@/lib/crm/access";
import { listDocuments } from "@/lib/crm/knowledge-docs";
import { skillStatus } from "@/lib/crm/skill";

export const metadata: Metadata = {
  title: "Knowledge",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const user = await getCrmPageUser();
  if (!user) notFound();

  // The house file's own health, shown beside the uploads. `loadSkill()` throws
  // when the knowledge is missing, and it throws on the AI routes only — so
  // until now the first sign of a build that shipped without SKILL.md was a 500
  // from the advisor. This is the one screen where "is the assistant's knowledge
  // there at all" is the question being asked, so it answers it.
  const [documents, house] = await Promise.all([
    listDocuments().catch(() => []),
    Promise.resolve(skillStatus()),
  ]);

  const adopted = documents.filter((d) => d.active_at).length;
  const unread = documents.filter((d) => d.status === "pending" || d.status === "learning").length;
  const failed = documents.filter((d) => d.status === "failed").length;

  return (
    <>
      <RecordHeader
        eyebrow="Assistant"
        title="Knowledge"
        intro="What the assistant has read. Upload a PDF or a Word file and it writes a note on it; adopt that note and it becomes part of what the assistant knows on every screen."
      />
      <section className="section">
        <div className="container-x space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="In the knowledge base"
              value={String(adopted)}
              hint="On every AI surface in the app"
            />
            <StatTile label="Uploaded in total" value={String(documents.length)} />
            <StatTile
              label="Being read"
              value={String(unread)}
              hint={unread > 0 ? "The list updates itself when each finishes" : undefined}
            />
            <StatTile
              label="Could not be read"
              value={String(failed)}
              hint={failed > 0 ? "Usually a scan — each row says which" : undefined}
            />
          </div>

          {/* The loud version of the failure `loadSkill()` guards against. A
              server whose knowledge directory did not survive the build answers
              500 on every AI route, and this is the only page that can say why
              in a sentence rather than in a log line. */}
          {!house.ok ? (
            <div className="rounded-card border border-err-500/40 bg-err-50 p-4">
              <p className="text-sm font-semibold text-err-700">
                The house knowledge base is not loading, and every AI feature in the app is failing
                because of it.
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-err-700/90">
                {house.error} Check <code>outputFileTracingIncludes</code> in{" "}
                <code>next.config.ts</code>: the build has to copy{" "}
                <code>src/lib/crm/knowledge</code> into the standalone output, and nothing imports
                the file so the tracer cannot find it on its own.
              </p>
            </div>
          ) : (
            <p className="text-xs text-ink-500">
              House knowledge base: {house.files} file{house.files === 1 ? "" : "s"},{" "}
              {house.chars.toLocaleString("en-GB")} characters, loaded. It is deployed with the app
              and is not editable here — it is the doctrine, and it outranks everything below.
            </p>
          )}

          <KnowledgeLibrary initial={documents} />
        </div>
      </section>
    </>
  );
}
