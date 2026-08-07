// Land we are considering buying, and the discussion about each one.
//
// Shared on purpose: everyone signed in sees the same list and the same
// argument. Whether a parcel is worth a million dollars is not a decision that
// should live in one person's inbox.
//
// `LandProspects` is mounted BOTH here and on /crm/land, from the same query —
// the ClientsBoard arrangement. The section page is where the work happens; this
// address survives because it is linked from the land search and is in people's
// bookmarks. A second, read-only copy of the list is what caused the bug this
// replaced: the arrangement showed on one page and not on the other.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { LandProspects, type ProspectRow } from "@/components/crm/LandProspects";
import { getCrmPageUser } from "@/lib/crm/access";
import { listLandProspects } from "@/lib/crm/portfolio";

export const metadata: Metadata = {
  title: "Saved listings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ProspectsPage() {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const rows = (await listLandProspects().catch(() => [])) as ProspectRow[];

  return (
    <>
      <RecordHeader
        eyebrow="Our land"
        title="Saved listings"
        breadcrumb={[{ href: "/crm/land", label: "Our land" }]}
        intro="Land BTB is considering buying. Paste a link, and everyone can weigh in."
      />
      <section className="section">
        <div className="container-x">
          <LandProspects initial={rows} />
        </div>
      </section>
    </>
  );
}
