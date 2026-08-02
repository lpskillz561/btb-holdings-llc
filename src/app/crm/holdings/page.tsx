import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { statusTone } from "@/lib/crm/tone";
import { Badge, EmptyState, StatTile, Table, Td } from "@/components/crm/ui";
import { getCrmPageUser } from "@/lib/crm/access";
import { fmtAcres, fmtDate, fmtMoney, fmtMoneyShort, fmtNum } from "@/lib/crm/format";
import { LABELS } from "@/lib/crm/types";
import { listPropertiesWithClient, listUnitsWithClient } from "@/lib/crm/views";

export const metadata: Metadata = {
  title: "Holdings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function HoldingsPage() {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const [properties, units] = await Promise.all([
    listPropertiesWithClient(),
    listUnitsWithClient(),
  ]);

  const ownedLand = properties.filter((p) => p.status === "owned");
  const acres = ownedLand.reduce((sum, p) => sum + (p.acres ?? 0), 0);
  const inService = units.filter((u) => u.status === "in_service");
  // Units that exist but aren't earning a deduction yet — the number worth
  // chasing, because the deduction turns on with the placed-in-service date.
  const awaitingService = units.filter(
    (u) => !u.placed_in_service_on && u.status !== "sold" && u.status !== "retired",
  );
  const rentRunRate = inService.reduce((sum, u) => sum + (u.monthly_rent_cents ?? 0), 0) * 12;

  return (
    <>
      <RecordHeader
        eyebrow="Portfolio"
        title="Holdings"
        intro="All land and every tiny home across every client, and which of them are actually in service."
      />

      <section className="section pt-12">
        <div className="container-x space-y-12">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Land owned" value={`${fmtNum(acres, 1)} ac`} hint={`${ownedLand.length} parcel(s)`} />
            <StatTile
              label="Units in service"
              value={`${inService.length} / ${units.length}`}
              tone="gold"
            />
            <StatTile
              label="Not yet in service"
              value={String(awaitingService.length)}
              hint="Deducting nothing until placed in service"
            />
            <StatTile label="Rent run rate" value={fmtMoneyShort(rentRunRate)} hint="Annualised" />
          </div>

          <div>
            <h2 className="mb-4 text-lg font-semibold text-ink-900">Tiny homes</h2>
            {units.length === 0 ? (
              <EmptyState>No units recorded yet.</EmptyState>
            ) : (
              <div className="sf-card">
                <Table
                  head={["Unit", "Client", "Status", "Use", "Sited on", "Cost", "Placed in service", "Rent"]}
                >
                  {units.map((row) => (
                    <tr key={row.id} className="transition hover:bg-white">
                      <Td>
                        <span className="font-medium text-ink-900">{row.label}</span>
                        {row.model && (
                          <span className="mt-0.5 block text-xs text-ink-500">
                            {[row.manufacturer, row.model].filter(Boolean).join(" ")}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <Link
                          href={`/crm/clients/${row.client_id}`}
                          className="text-ink-700 hover:text-gold-600"
                        >
                          {row.client_name}
                        </Link>
                      </Td>
                      <Td>
                        <Badge tone={statusTone(row.status)}>{LABELS.unitStatus[row.status]}</Badge>
                      </Td>
                      <Td>{LABELS.unitUse[row.unit_use]}</Td>
                      <Td className="text-ink-700">{row.property_label ?? "—"}</Td>
                      <Td className="whitespace-nowrap">{fmtMoney(row.purchase_price_cents)}</Td>
                      <Td className="whitespace-nowrap">
                        {row.placed_in_service_on ? (
                          fmtDate(row.placed_in_service_on)
                        ) : (
                          <span className="text-amber-700">Not yet</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">{fmtMoney(row.monthly_rent_cents)}</Td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-4 text-lg font-semibold text-ink-900">Land</h2>
            {properties.length === 0 ? (
              <EmptyState>
                No land recorded yet. Shortlist parcels from a client&apos;s Land search tab.
              </EmptyState>
            ) : (
              <div className="sf-card">
                <Table
                  head={["Parcel", "Client", "Status", "Where", "Lot size", "Purchase price", "Purchased"]}
                >
                  {properties.map((row) => (
                    <tr key={row.id} className="transition hover:bg-white">
                      <Td>
                        <span className="font-medium text-ink-900">{row.label}</span>
                        {row.address && (
                          <span className="mt-0.5 block text-xs text-ink-500">{row.address}</span>
                        )}
                      </Td>
                      <Td>
                        <Link
                          href={`/crm/clients/${row.client_id}`}
                          className="text-ink-700 hover:text-gold-600"
                        >
                          {row.client_name}
                        </Link>
                      </Td>
                      <Td>
                        <Badge tone={statusTone(row.status)}>
                          {LABELS.propertyStatus[row.status]}
                        </Badge>
                      </Td>
                      <Td className="text-ink-700">
                        {[row.county && `${row.county} County`, row.state].filter(Boolean).join(", ") || "—"}
                      </Td>
                      <Td className="whitespace-nowrap">{fmtAcres(row.acres)}</Td>
                      <Td className="whitespace-nowrap">{fmtMoney(row.purchase_price_cents)}</Td>
                      <Td className="whitespace-nowrap text-ink-600">
                        {fmtDate(row.purchase_date)}
                      </Td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
