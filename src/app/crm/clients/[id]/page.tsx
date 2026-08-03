import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClientCard } from "@/components/crm/ClientCard";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { getCrmPageUser } from "@/lib/crm/access";
import { getClientDetail } from "@/lib/crm/clients";
import { CrmError } from "@/lib/crm/db";
import {
  DEFAULT_BONUS_RATE_BPS,
  DEFAULT_DEPOSIT_BPS,
  DEFAULT_MARGINAL_RATE_BPS,
  DEFAULT_OCCUPANCY_BPS,
  DEFAULT_OPEX_BPS,
  DEFAULT_USEFUL_LIFE_YEARS,
} from "@/lib/crm/economics";
import { isAiConfigured } from "@/lib/crm/ai";
import { fmtMoney } from "@/lib/crm/format";
import { LABELS } from "@/lib/crm/types";
import { listStates } from "@/lib/parcels";

export const metadata: Metadata = {
  title: "Client",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const { id } = await params;

  const detail = await getClientDetail(id).catch((err) => {
    if (err instanceof CrmError && err.status === 404) notFound();
    throw err;
  });
  const states = await listStates().catch(() => []);

  // The proposal generator's assumptions come from the environment (and the
  // client's own rate when recorded), resolved here so the browser never has to
  // read server config to show the right starting values.
  const proposalDefaults = {
    depositBps: DEFAULT_DEPOSIT_BPS(),
    marginalRateBps: detail.client.marginal_rate_bps ?? DEFAULT_MARGINAL_RATE_BPS(),
    bonusRateBps: DEFAULT_BONUS_RATE_BPS(),
    usefulLifeYears: DEFAULT_USEFUL_LIFE_YEARS(),
    occupancyBps: DEFAULT_OCCUPANCY_BPS(),
    opexBps: DEFAULT_OPEX_BPS(),
  };

  const summary = [
    LABELS.clientStatus[detail.client.status],
    detail.client.target_writeoff_cents
      ? `targeting ${fmtMoney(detail.client.target_writeoff_cents)}`
      : null,
    `${detail.units.length} unit${detail.units.length === 1 ? "" : "s"}`,
    `${detail.properties.length} land holding${detail.properties.length === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <RecordHeader
        eyebrow="Client"
        title={detail.client.name}
        intro={summary}
        breadcrumb={[{ href: "/crm", label: "CRM" }]}
      />
      <ClientCard
        detail={detail}
        states={states}
        proposalDefaults={proposalDefaults}
        aiEnabled={isAiConfigured()}
      />
    </>
  );
}
