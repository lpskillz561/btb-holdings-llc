// BTB's own land.
//
// Deliberately a separate section from Holdings. Holdings answers "what do our
// clients own"; this answers "what do WE own, and how much of it is working".
// Since the business changed — BTB owns the land, the client owns only the home
// standing on it — these are different books and merging them would double-count
// the same physical park.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmNav } from "@/components/crm/CrmNav";
import { Badge, EmptyState, StatTile, Table, Td } from "@/components/crm/ui";
import { getCrmPageUser } from "@/lib/crm/access";
import { fmtAcres, fmtDate, fmtMoney, fmtMoneyShort, fmtNum, fmtPct } from "@/lib/crm/format";
import { DEFAULT_OCCUPANCY_BPS } from "@/lib/crm/economics";
import { annualGrossCents, getBookSummary, listParksWithCapacity } from "@/lib/crm/portfolio";
import { statusTone } from "@/lib/crm/tone";
import { LABELS } from "@/lib/crm/types";

export const metadata: Metadata = {
  title: "Our land",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function LandPage() {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const [allParks, book] = await Promise.all([listParksWithCapacity(), getBookSummary()]);

  // A prospect is land we are considering, not land we hold. Mixing the two in
  // one table was the confusion: an Orlando listing appeared as a "park" with
  // zero pads, which reads as a park we own and have not built out.
  const parks = allParks.filter((p) => p.status !== "prospect");
  const prospects = allParks.filter((p) => p.status === "prospect");
  const occupancyBps = DEFAULT_OCCUPANCY_BPS();
  const annual = annualGrossCents(book.occupied_nightly_cents, occupancyBps);

  // Pads that could earn and don't. The number worth acting on: an available pad
  // is capital already spent that is returning nothing.
  const utilisationBps =
    book.pads_total > 0 ? Math.round((book.pads_occupied / book.pads_total) * 10_000) : null;

  return (
    <>
      <CrmNav
        current="/crm/land"
        eyebrow="Portfolio"
        title="Our land"
        intro="The parks BTB owns, the pads on them, and how much of that capacity is earning."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/crm/land/prospects" className="sf-btn-neutral">
              Saved listings
            </Link>
            <Link href="/crm/land/search" className="sf-btn-brand">
              Find land to buy
            </Link>
          </div>
        }
      />

      <section className="section pt-12">
        <div className="container-x space-y-12">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Land owned"
              value={fmtAcres(book.acres)}
              hint={`${book.parks} park${book.parks === 1 ? "" : "s"}`}
            />
            <StatTile
              label="Pads occupied"
              value={`${book.pads_occupied} / ${book.pads_total}`}
              hint={utilisationBps === null ? "No pads built yet" : `${fmtPct(utilisationBps, { digits: 0 })} utilised`}
              tone="gold"
            />
            <StatTile
              label="Available now"
              value={String(book.pads_available)}
              hint={`${book.pads_pipeline} planned or building`}
            />
            <StatTile
              label="Projected gross"
              value={fmtMoneyShort(annual)}
              hint={`Annual at ${fmtPct(occupancyBps, { digits: 0 })} occupancy`}
            />
          </div>

          <div>
            <h2 className="mb-1 text-lg font-semibold text-ink-900">Parks</h2>
            <p className="mb-4 text-sm text-ink-600">
              Capacity is counted from pads, not from planned figures — a park with no pads built
              shows zero, which is the honest answer.
            </p>
            {parks.length === 0 ? (
              <EmptyState>
                BTB does not own any land yet.
                {prospects.length > 0
                  ? " There are saved listings below that have not been bought."
                  : " Save a listing, or add a park once one is bought."}
              </EmptyState>
            ) : (
              <div className="sf-card">
                <Table
                  head={[
                    "Park",
                    "Where",
                    "Acres",
                    "Status",
                    "Pads",
                    "Occupied",
                    "Available",
                    "Land basis",
                  ]}
                >
                  {parks.map((park) => (
                    <tr key={park.id} className="border-t border-ink-200">
                      <Td>
                        <Link href={`/crm/land/${park.id}`} className="link-underline font-medium">
                          {park.name}
                        </Link>
                      </Td>
                      <Td>
                        {[park.city, park.county, park.state].filter(Boolean).join(", ") || "—"}
                      </Td>
                      <Td>{fmtAcres(park.acres)}</Td>
                      <Td>
                        <Badge tone={statusTone(park.status)}>
                          {LABELS.parkStatus[park.status] ?? park.status}
                        </Badge>
                      </Td>
                      <Td>
                        {fmtNum(park.pad_count)}
                        {park.planned_pad_count && park.planned_pad_count > park.pad_count ? (
                          <span className="text-ink-500">
                            {" "}
                            of {fmtNum(park.planned_pad_count)} planned
                          </span>
                        ) : null}
                      </Td>
                      <Td>{fmtNum(park.occupied_pads)}</Td>
                      <Td>{fmtNum(park.available_pads)}</Td>
                      <Td>{fmtMoney(park.land_basis_cents)}</Td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </div>

          {/* Saved listings, inline. Reachable without hunting for the button
              in the header — this is where someone looking at our land expects
              to find the land we are thinking about buying. */}
          {prospects.length > 0 ? (
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-ink-900">
                  Considering{" "}
                  <span className="font-normal text-ink-600">({prospects.length})</span>
                </h2>
                <Link href="/crm/land/prospects" className="link-underline text-sm">
                  Open saved listings and discussion →
                </Link>
              </div>
              <p className="mb-3 text-sm text-ink-600">
                Land BTB does not own yet. These are excluded from the figures above.
              </p>
              <div className="sf-card">
                <Table head={["Listing", "Where", "Acres", "Asking", "Saved", ""]}>
                  {prospects.map((park) => (
                    <tr key={park.id} className="border-t border-ink-200">
                      <Td>
                        {park.listing_url ? (
                          <a
                            href={park.listing_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-sf-600 hover:underline"
                          >
                            {park.name}
                          </a>
                        ) : (
                          <span className="font-medium text-ink-900">{park.name}</span>
                        )}
                      </Td>
                      <Td>
                        {[park.city, park.county, park.state].filter(Boolean).join(", ") || "—"}
                      </Td>
                      <Td>{park.acres === null ? "—" : fmtAcres(park.acres)}</Td>
                      <Td>{fmtMoney(park.asking_price_cents)}</Td>
                      <Td className="whitespace-nowrap">{fmtDate(park.created_at)}</Td>
                      <Td>
                        <Link
                          href="/crm/land/prospects"
                          className="sf-btn-neutral py-0.5 text-xs"
                        >
                          Discuss
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </Table>
              </div>
            </div>
          ) : null}

          <p className="text-xs leading-relaxed text-ink-500">
            Land basis is purchase price plus closing costs and is never depreciable. Pad site work
            is tracked separately on each pad because it generally is depreciable, as land
            improvements — see <code>lib/crm/economics.ts</code>. Projected gross is the nightly rate
            across occupied pads at the configured occupancy; it is a model, not booking data.
          </p>
        </div>
      </section>
    </>
  );
}
