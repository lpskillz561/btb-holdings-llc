// The amusement-equipment scenario tool.
//
// INTERNAL, and it keeps the Lightning chrome — note the route is /crm/equipment
// and not anything under /crm/present, so `isClientFacingRoute` leaves the nav
// and the Ask AI button in place. That is the right call: this page shows the
// gross-versus-capped tax benefit side by side and names where the competing
// sales material fails to reconcile. It is written for staff on a call, not for
// the shared screen — the client-facing version of the same model is the
// estimator slide in the Equipment deck.
//
// Configuration is resolved HERE and passed down. `equipmentConfig()` reads
// `process.env`, which is not populated in a client bundle, so a workbench that
// called it itself would silently run on the built-in defaults while the deck
// ran on the SSM values.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EquipmentWorkbench } from "@/components/crm/EquipmentWorkbench";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { getCrmPageUser } from "@/lib/crm/access";
import { DEFAULT_BONUS_RATE_BPS, DEFAULT_MARGINAL_RATE_BPS } from "@/lib/crm/economics";
import { equipmentConfig } from "@/lib/crm/equipment";

export const metadata: Metadata = {
  title: "Equipment",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function EquipmentPage() {
  const user = await getCrmPageUser();
  if (!user) notFound();

  return (
    <>
      <RecordHeader
        eyebrow="Programme"
        title="Amusement equipment"
        intro="The second product line: commercial amusement equipment under §168(k), Asset Class 79.0. Run a sizing here before it reaches a slide or a proposal — every figure comes from lib/crm/equipment.ts, which is the same module the deck estimator uses."
        actions={
          <a
            href="/crm/present?track=equipment"
            target="_blank"
            rel="noopener"
            className="sf-btn-brand shrink-0"
          >
            Open the deck
          </a>
        }
      />

      <section className="section pt-12">
        <div className="container-x">
          <EquipmentWorkbench
            config={equipmentConfig()}
            marginalRateBps={DEFAULT_MARGINAL_RATE_BPS()}
            bonusRateBps={DEFAULT_BONUS_RATE_BPS()}
          />
        </div>
      </section>
    </>
  );
}
