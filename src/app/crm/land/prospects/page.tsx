// Land we are considering buying, and the discussion about each one.
//
// Shared on purpose: everyone signed in sees the same list and the same
// argument. Whether a parcel is worth a million dollars is not a decision that
// should live in one person's inbox.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CrmNav } from "@/components/crm/CrmNav";
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
      <CrmNav
        current="/crm/land"
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
