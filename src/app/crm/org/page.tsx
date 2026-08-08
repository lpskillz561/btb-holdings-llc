// BTB's leadership chart — who reports to whom.
//
// It is under `/crm` because that is what gates it. The middleware matcher is
// `/crm/:path*`, so a top-level `/org` would be PUBLIC, and this page names our
// staff, their jobs and their faces.
//
// Internal only, deliberately. It is not a slide and it is not in the client
// deck: the deck draws the OWNERSHIP chain — trust, Series, Management Series —
// which is a different diagram answering a different question, and painting one
// out of the internal theme would put a variable-backed token on a client-facing
// surface. See CLAUDE.md, "Two looks, on purpose".

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrgChart } from "@/components/crm/OrgChart";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { getCrmPageUser } from "@/lib/crm/access";
import { listOrgPeople } from "@/lib/crm/org";

export const metadata: Metadata = {
  title: "Team",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OrgPage() {
  const user = await getCrmPageUser();
  if (!user) notFound();

  // Best-effort, like the deck's client lookup. An empty chart with a working
  // "Add someone" button is a better answer to a database blip than a 500 on a
  // page whose whole content is one small table.
  const people = await listOrgPeople().catch(() => []);

  return (
    <>
      <RecordHeader
        eyebrow="The company"
        title="Team"
        intro="Who is in charge of whom. Add a person, give them a title and a photograph, and say who they report to — the chart draws itself from that. Drag a card if you want it somewhere else."
      />
      <section className="section">
        <div className="container-x">
          <OrgChart initial={people} />
        </div>
      </section>
    </>
  );
}
