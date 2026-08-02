// Parcel search scoped to one client. Same engine as /api/property; the
// difference is that the client's recorded criteria supply every default, so the
// first search from the client card is already the right search.

import { NextResponse } from "next/server";
import { isSortKey } from "@/lib/parcels";
import { getClient } from "@/lib/crm/clients";
import { searchLandForClient } from "@/lib/crm/land";
import { withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

/** Tolerates "$120,000" and blank. Undefined means "no opinion, use the client's". */
function parseNumber(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export const GET = withCrm(async (req) => {
  const sp = req.nextUrl.searchParams;
  const clientId = sp.get("client_id");
  if (!clientId) {
    return NextResponse.json({ error: "client_id is required." }, { status: 400 });
  }
  const client = await getClient(clientId);

  const page = Number(sp.get("page") ?? "1");
  const sortParam = sp.get("sort");
  const totalRaw = Number(sp.get("total"));

  const result = await searchLandForClient(client, {
    area: sp.get("area"),
    page: Number.isFinite(page) ? page : 1,
    // Explicit "0" turns the vacant-land default off; absent leaves it on.
    landOnly: sp.has("land") ? sp.get("land") === "1" : undefined,
    minAcres: parseNumber(sp.get("minac")) ?? null,
    maxAcres: parseNumber(sp.get("maxac")) ?? null,
    minPrice: parseNumber(sp.get("min")) ?? null,
    maxPrice: parseNumber(sp.get("max")) ?? null,
    sort: isSortKey(sortParam) ? sortParam : undefined,
    // Carried from a prior page so pagination skips the COUNT(*) — see parcels.ts.
    knownTotal: Number.isInteger(totalRaw) && totalRaw >= 0 && page > 1 ? totalRaw : undefined,
  });

  return NextResponse.json(result);
});
