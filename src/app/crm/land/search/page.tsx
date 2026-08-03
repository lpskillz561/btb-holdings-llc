// Where BTB should buy land.
//
// Distinct from the client card's Land search tab, which finds land for a
// CLIENT. Under the current model the client never buys ground — BTB does — so
// this is the one that matters for building parks, and it is global rather than
// hung off an account.
//
// The suggestions are computed in lib/crm/siteScore.ts, in ordinary arithmetic.
// Nothing here is model-generated: "buy in this county" is a figure someone
// spends a million dollars against.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { AssessSite } from "@/components/crm/AssessSite";
import { Badge, EmptyState, StatTile, Table, Td } from "@/components/crm/ui";
import { getCrmPageUser } from "@/lib/crm/access";
import { fmtAcres, fmtMoney, fmtMoneyShort, fmtNum } from "@/lib/crm/format";
import {
  MIN_VIABLE_PADS,
  PAD_FOOTPRINT_SQFT,
  USABLE_SHARE_BPS,
  parcelsAvailable,
  rankCounties,
  siteFit,
} from "@/lib/crm/siteScore";
import { SORT_OPTIONS, STATE_NAMES, isSortKey, listStates, searchArea, type SortKey } from "@/lib/parcels";

export const metadata: Metadata = {
  title: "Land search",
  robots: { index: false, follow: false },
};

const SORT_LABELS: Record<SortKey, string> = {
  acres_desc: "Lot size: largest first",
  acres_asc: "Lot size: smallest first",
  assessed_desc: "Assessed value: high to low",
  assessed_asc: "Assessed value: low to high",
  sale_desc: "Last sale price: high to low",
  sale_asc: "Last sale price: low to high",
  sold_newest: "Last sold: newest first",
  sold_oldest: "Last sold: oldest first",
};

export const dynamic = "force-dynamic";

export default async function LandSearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    state?: string;
    minAcres?: string;
    maxPrice?: string;
    county?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const sp = await searchParams;
  const state = (sp.state ?? "").toUpperCase() || null;
  const minAcres = Number(sp.minAcres) > 0 ? Number(sp.minAcres) : 5;
  const maxPrice = Number(sp.maxPrice) > 0 ? Number(sp.maxPrice) : undefined;
  const wantCounty = (sp.county ?? "").trim();
  // Largest-first is the useful default when you are hunting for room to build,
  // but assessed value is what someone screening on price wants.
  const sort: SortKey = isSortKey(sp.sort) ? sp.sort : "acres_desc";
  const page = Math.max(1, Number(sp.page) || 1);

  const availability = await parcelsAvailable();

  // Before the first ETL run there is no `parcels` table at all. Say so plainly
  // rather than rendering an empty search that looks broken.
  if (!availability.ready || availability.rows === 0) {
    return (
      <>
        <RecordHeader
          eyebrow="Our land"
          title="Land search"
          breadcrumb={[{ href: "/crm/land", label: "Our land" }]}
          intro="Find ground to build parks on."
        />
        <section className="section">
          <div className="container-x">
            <EmptyState>
              The parcel database has not been loaded into this environment yet, so there is nothing
              to search. It is imported by the ETL — see <code>infra/etl/README.md</code>. Land
              search will start working the moment the first state finishes importing.
            </EmptyState>
          </div>
        </section>
      </>
    );
  }

  const [states, counties] = await Promise.all([
    listStates().catch(() => []),
    rankCounties({ state, minAcres }).catch(() => []),
  ]);

  // Parcels in the chosen county — the best-scoring one by default, so the page
  // answers "where" and "which" in one screen, but any row in the ranking can be
  // clicked to look inside it instead.
  const focus =
    (wantCounty
      ? counties.find((c) => c.county.toLowerCase() === wantCounty.toLowerCase())
      : undefined) ?? counties[0];
  const results = focus
    ? await searchArea(`${focus.county}, ${focus.state}`, page, {
        landOnly: true,
        minAcres,
        maxPrice,
        sort,
      }).catch(() => null)
    : null;

  /**
   * Every link on this page rebuilds the whole query.
   *
   * Paging that dropped the county, or a county link that dropped the sort,
   * would silently change the search someone is reading — so state lives in one
   * builder rather than being reassembled per link.
   */
  const hrefWith = (over: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    const base: Record<string, string | number | undefined> = {
      state: state ?? undefined,
      minAcres: sp.minAcres ? minAcres : undefined,
      maxPrice: maxPrice,
      county: wantCounty || undefined,
      sort: sort !== "acres_desc" ? sort : undefined,
      page: page > 1 ? page : undefined,
      ...over,
    };
    for (const [k, v] of Object.entries(base)) {
      if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
    }
    const q = qs.toString();
    return q ? `/crm/land/search?${q}` : "/crm/land/search";
  };
  // Changing the county or the sort starts the results again from page one.
  const countyHref = (county: string) => hrefWith({ county, page: undefined });

  return (
    <>
      <RecordHeader
        eyebrow="Our land"
        title="Land search"
        breadcrumb={[{ href: "/crm/land", label: "Our land" }]}
        intro="Where to buy ground for the next park, scored on what it would cost per pad."
      />

      <section className="section">
        <div className="container-x space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Parcels indexed" value={fmtNum(availability.rows)} />
            <StatTile label="Counties scored" value={String(counties.length)} tone="gold" />
            <StatTile
              label="Assumed pad footprint"
              value={`${fmtNum(PAD_FOOTPRINT_SQFT())} sq ft`}
              hint="Includes access and setback"
            />
            <StatTile
              label="Usable share of a parcel"
              value={`${USABLE_SHARE_BPS() / 100}%`}
              hint="Conservative on purpose"
            />
          </div>

          {/* GET form: the whole query lives in the URL, so a promising search
              is a link somebody can send to a colleague. */}
          <form method="GET" className="sf-card flex flex-wrap items-end gap-4 p-4">
            <div>
              <label className="sf-label" htmlFor="state">State</label>
              <select id="state" name="state" defaultValue={state ?? ""} className="sf-input">
                <option value="">Any state</option>
                {states.map((s) => (
                  <option key={s.code} value={s.code}>
                    {STATE_NAMES[s.code] ?? s.code} ({fmtNum(s.count)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="sf-label" htmlFor="minAcres">Minimum acres</label>
              <input id="minAcres" name="minAcres" type="number" min="1" step="1"
                     defaultValue={minAcres} className="sf-input w-32" />
            </div>
            <div>
              <label className="sf-label" htmlFor="maxPrice">Max assessed value</label>
              <input id="maxPrice" name="maxPrice" type="number" min="0" step="1000"
                     defaultValue={maxPrice ?? ""} placeholder="any" className="sf-input w-40" />
            </div>
            <div>
              <label className="sf-label" htmlFor="sort">Sort by</label>
              <select id="sort" name="sort" defaultValue={sort} className="sf-input">
                {(Object.keys(SORT_OPTIONS) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
            {/* Keep the open county when the filters change; a new search should
                not silently throw you back to the top-ranked one. */}
            {wantCounty && <input type="hidden" name="county" value={wantCounty} />}
            <button type="submit" className="sf-btn-brand">Search</button>
          </form>

          {/* The manual half of land sourcing. Someone finds a listing on Zillow
              that no assessment roll knows is for sale — this says where it goes,
              because a feature nobody can find is one nobody uses. */}
          <p className="rounded border border-sf-200 bg-sf-50 px-4 py-3 text-sm text-ink-700">
            <strong className="text-ink-900">Found something on Zillow?</strong> This searches the
            assessment roll, which knows what exists but not what is for sale. Paste a Zillow,
            LandWatch or agent link into{" "}
            <Link href="/crm/land/prospects" className="font-semibold text-sf-600 hover:underline">
              Saved listings
            </Link>{" "}
            to keep it with the rest of the pipeline, where everyone signed in can see it and weigh
            in.
          </p>

          {/* ---- the suggestion ---- */}
          <div>
            <h2 className="text-sm font-bold text-ink-900">Best places to buy</h2>
            <p className="mb-3 mt-1 text-sm text-ink-600">
              Counties ranked on assessed land value per pad we could build, how many candidate
              parcels there are, and whether a typical parcel is even big enough to be worth
              developing. Medians, not averages — assessment rolls have a long tail of enormous
              ranch parcels that drag a mean somewhere useless.
            </p>
            {counties.length === 0 ? (
              <EmptyState>
                No county cleared the floor of {minAcres} acres and five candidate parcels. Try a
                lower acreage, or a different state.
              </EmptyState>
            ) : (
              <div className="sf-card">
                <Table
                  head={["Rank", "County", "Score", "Candidates", "Median size", "Median value", "Pads", "Land per pad"]}
                >
                  {counties.map((c, i) => {
                    const active =
                      focus && c.county === focus.county && c.state === focus.state;
                    return (
                    <tr
                      key={`${c.state}-${c.county}`}
                      className={`border-t border-ink-200 ${active ? "bg-sf-50" : ""}`}
                    >
                      <Td>{i + 1}</Td>
                      <Td>
                        {/* Every county is openable, not just the top one. */}
                        <Link href={countyHref(c.county)} className="font-medium text-ink-900 hover:text-sf-600 hover:underline">
                          {c.county}
                        </Link>
                        <span className="ml-1.5 text-ink-500">
                          {STATE_NAMES[c.state] ?? c.state}
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={c.score >= 70 ? "green" : c.score >= 45 ? "gold" : "neutral"}>
                          {c.score}
                        </Badge>
                      </Td>
                      <Td>{fmtNum(c.candidates)}</Td>
                      <Td>{fmtAcres(c.median_acres)}</Td>
                      <Td>{fmtMoneyShort(c.median_value_cents)}</Td>
                      <Td>
                        {c.median_pads}
                        {c.median_pads < MIN_VIABLE_PADS() ? (
                          <span className="ml-1 text-ink-500">(thin)</span>
                        ) : null}
                      </Td>
                      <Td className="font-medium">
                        {c.median_cost_per_pad_cents === null
                          ? "—"
                          : fmtMoney(c.median_cost_per_pad_cents)}
                      </Td>
                    </tr>
                    );
                  })}
                </Table>
              </div>
            )}
          </div>

          {/* ---- parcels in the leading county ---- */}
          {focus && results ? (
            <div>
              <h2 className="text-sm font-bold text-ink-900">
                Candidate parcels in {focus.county}, {focus.state}
              </h2>
              <p className="mb-3 mt-1 text-sm text-ink-600">
                Land-only parcels of at least {minAcres} acres, {SORT_LABELS[sort].toLowerCase()}.{" "}
                {fmtNum(results.total)} match — showing {fmtNum((page - 1) * results.pageSize + 1)}
                –{fmtNum((page - 1) * results.pageSize + results.rows.length)}.
              </p>
              {results.rows.length === 0 ? (
                <EmptyState>Nothing in this county matched those filters.</EmptyState>
              ) : (
                <div className="sf-card">
                  <Table head={["Parcel", "Acres", "Assessed", "Pads it fits", "Land per pad", "Owner", ""]}>
                    {results.rows.map((row) => {
                      const fit = siteFit(
                        row.acres,
                        row.assessedTotal ? row.assessedTotal * 100 : null,
                      );
                      return (
                        <tr key={row.parcelId ?? row.oneLine} className="border-t border-ink-200">
                          <Td>
                            <span className="text-ink-900">{row.oneLine ?? row.parcelId}</span>
                          </Td>
                          <Td>{fmtAcres(row.acres)}</Td>
                          <Td>{row.assessedTotal ? fmtMoney(row.assessedTotal * 100) : "—"}</Td>
                          <Td>
                            {fit.padsThatFit}
                            {!fit.viable ? (
                              <span className="ml-1 text-ink-500">(thin)</span>
                            ) : null}
                          </Td>
                          <Td className="font-medium">
                            {fit.landCostPerPadCents === null
                              ? "—"
                              : fmtMoney(fit.landCostPerPadCents)}
                          </Td>
                          <Td className="text-ink-600">{row.owner ?? "—"}</Td>
                          <Td className="align-top">
                            {row.parcelId ? (
                              <AssessSite
                                parcelKey={row.parcelId}
                                label={row.oneLine ?? row.parcelId}
                              />
                            ) : null}
                          </Td>
                        </tr>
                      );
                    })}
                  </Table>
                </div>
              )}

              {(page > 1 || results.hasNext) && (
                <div className="mt-3 flex items-center justify-between">
                  {page > 1 ? (
                    <Link href={hrefWith({ page: page - 1 })} className="sf-btn-neutral">
                      ← Previous
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="sf-meta">Page {fmtNum(page)}</span>
                  {results.hasNext ? (
                    <Link href={hrefWith({ page: page + 1 })} className="sf-btn-neutral">
                      Next →
                    </Link>
                  ) : (
                    <span />
                  )}
                </div>
              )}
            </div>
          ) : null}

          <p className="text-xs leading-relaxed text-ink-500">
            <strong>What this is not.</strong> The parcel database carries the assessor&rsquo;s value
            and the last recorded sale — <em>not</em> an asking price. These figures screen where to
            look; they are not valuations and nothing here is an offer. Land is never depreciable, so
            whatever BTB pays for ground stays in basis and never becomes a client&rsquo;s write-off
            — see <code>lib/crm/economics.ts</code>. Confirm zoning and whether transient lodging is
            permitted before committing: the 30-day rule the whole tax position rests on is a
            <em> use</em> question, and a county that forbids it makes the parcel worthless to us at
            any price. <Link href="/crm/land" className="link-underline">Back to our land</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
