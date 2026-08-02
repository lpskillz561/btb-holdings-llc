// One park, and every pad on it.
//
// The pad table is the answer to two questions that only exist under the current
// ownership model: which client's home is standing on which piece of our land,
// and how much room is left to build.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmNav } from "@/components/crm/CrmNav";
import { Badge, Detail, EmptyState, StatTile, Table, Td } from "@/components/crm/ui";
import { getCrmPageUser } from "@/lib/crm/access";
import { CrmError, queryOne } from "@/lib/crm/db";
import { DEFAULT_OCCUPANCY_BPS } from "@/lib/crm/economics";
import { fmtAcres, fmtDate, fmtMoney, fmtNum, fmtPct } from "@/lib/crm/format";
import { annualGrossCents, listPadsForPark } from "@/lib/crm/portfolio";
import { statusTone } from "@/lib/crm/tone";
import { LABELS, type CrmPark } from "@/lib/crm/types";

export const metadata: Metadata = {
  title: "Park",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Square feet in an acre — the same constant the SQL share calculation uses. */
const SQFT_PER_ACRE = 43_560;

export default async function ParkPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const { id } = await params;
  const park = await queryOne<CrmPark>(`SELECT * FROM crm_parks WHERE id = $1`, [id]).catch(
    (err) => {
      if (err instanceof CrmError && err.status === 404) notFound();
      throw err;
    },
  );
  if (!park) notFound();

  const pads = await listPadsForPark(park.id);
  const occupancyBps = DEFAULT_OCCUPANCY_BPS();

  const occupied = pads.filter((p) => p.status === "occupied");
  const available = pads.filter((p) => p.status === "available");
  const occupiedNightly = occupied.reduce((s, p) => s + (p.nightly_rate_cents ?? 0), 0);
  const padSqft = pads.reduce((s, p) => s + (p.pad_sqft ?? 0), 0);
  const siteWork = pads.reduce((s, p) => s + (p.site_work_cents ?? 0), 0);

  // How much of the park the pads actually take up. Usually well under half —
  // roads, setbacks and amenity space are the rest — so a low number is normal
  // and a number near 100% means the acreage is probably wrong.
  const parkSqft = (park.acres ?? 0) * SQFT_PER_ACRE;
  const builtBps = parkSqft > 0 ? Math.round((padSqft / parkSqft) * 10_000) : null;

  return (
    <>
      <CrmNav
        current="/crm/land"
        eyebrow="Our land"
        title={park.name}
        breadcrumb={[{ href: "/crm/land", label: "Our land" }]}
        intro={[park.address, park.city, park.county, park.state].filter(Boolean).join(", ")}
      />

      <section className="section pt-12">
        <div className="container-x space-y-12">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Acres" value={fmtAcres(park.acres)} hint={LABELS.parkStatus[park.status] ?? park.status} />
            <StatTile
              label="Pads occupied"
              value={`${occupied.length} / ${pads.length}`}
              tone="gold"
              hint={`${available.length} available`}
            />
            <StatTile
              label="Projected gross"
              value={fmtMoney(annualGrossCents(occupiedNightly, occupancyBps))}
              hint={`Annual at ${fmtPct(occupancyBps, { digits: 0 })}`}
            />
            <StatTile
              label="Land under pads"
              value={builtBps === null ? "—" : fmtPct(builtBps, { digits: 1 })}
              hint={`${fmtNum(padSqft)} sq ft of pads`}
            />
          </div>

          <div className="sf-card p-6">
            <h2 className="mb-4 text-lg font-semibold text-ink-900">Record</h2>
            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Purchase price">{fmtMoney(park.purchase_price_cents)}</Detail>
              <Detail label="Closing costs">{fmtMoney(park.closing_costs_cents)}</Detail>
              <Detail label="Land basis">
                {fmtMoney((park.purchase_price_cents ?? 0) + (park.closing_costs_cents ?? 0))}
              </Detail>
              <Detail label="Land improvements">{fmtMoney(park.improvements_cents)}</Detail>
              <Detail label="Pad site work">{fmtMoney(siteWork)}</Detail>
              <Detail label="Purchased">{fmtDate(park.purchase_date)}</Detail>
              <Detail label="Assessed value">{fmtMoney(park.assessed_value_cents)}</Detail>
              <Detail label="Annual property tax">{fmtMoney(park.annual_property_tax_cents)}</Detail>
              <Detail label="Parcel key">{park.parcel_key ?? "—"}</Detail>
            </div>
            {park.notes ? (
              <p className="mt-5 whitespace-pre-wrap text-sm text-ink-700">{park.notes}</p>
            ) : null}
          </div>

          <div>
            <h2 className="mb-1 text-lg font-semibold text-ink-900">Pads</h2>
            <p className="mb-4 text-sm text-ink-600">
              Every numbered site, and whose home is on it. A pad with no occupant and a status of
              available is capital already spent that is earning nothing.
            </p>
            {pads.length === 0 ? (
              <EmptyState>
                No pads on this park yet
                {park.planned_pad_count ? ` — ${fmtNum(park.planned_pad_count)} planned` : ""}.
              </EmptyState>
            ) : (
              <div className="sf-card">
                <Table
                  head={["Pad", "Status", "Size", "Utilities", "Nightly", "Home", "Owner"]}
                >
                  {pads.map((pad) => (
                    <tr key={pad.id} className="border-t border-ink-200">
                      <Td className="font-medium">{pad.label}</Td>
                      <Td>
                        <Badge tone={statusTone(pad.status)}>
                          {LABELS.padStatus[pad.status] ?? pad.status}
                        </Badge>
                      </Td>
                      <Td>{pad.pad_sqft ? `${fmtNum(pad.pad_sqft)} sq ft` : "—"}</Td>
                      <Td>
                        {[
                          pad.has_water ? "water" : null,
                          pad.has_sewer ? "sewer" : null,
                          pad.has_power ? "power" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </Td>
                      <Td>{fmtMoney(pad.nightly_rate_cents)}</Td>
                      <Td>{pad.unit_label ?? "—"}</Td>
                      <Td>
                        {pad.unit_id === null ? (
                          "—"
                        ) : pad.unit_client_id ? (
                          <Link
                            href={`/crm/clients/${pad.unit_client_id}`}
                            className="link-underline"
                          >
                            {pad.client_name}
                          </Link>
                        ) : (
                          // No client means BTB owns the home as well as the pad.
                          <Badge tone="navy">BTB</Badge>
                        )}
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
