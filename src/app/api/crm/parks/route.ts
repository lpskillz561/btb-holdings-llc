import { NextResponse, type NextRequest } from "next/server";
import { nameFromListingUrl } from "@/lib/crm/portfolio";
import { PARKS } from "@/lib/crm/resource";
import { collectionHandlers, crmError, readBody } from "@/lib/crm/rest";
import { createRow } from "@/lib/crm/resource";
import { requireCrmApiUser } from "@/lib/crm/access";

export const runtime = "nodejs";

const handlers = collectionHandlers(PARKS);
export const GET = handlers.GET;

/**
 * Create a park, or save a listing.
 *
 * The generic handler requires a name. Saving a prospect should be one field —
 * paste a link — so when only a URL arrives the name is derived from it. Zillow
 * puts the address in the slug, so this usually produces something readable
 * without anyone typing.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireCrmApiUser(req);
    const body = await readBody(req);
    if (!body.name && typeof body.listing_url === "string" && body.listing_url.trim()) {
      body.name = nameFromListingUrl(body.listing_url.trim());
    }
    const row = await createRow(PARKS, body, session.sub);
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return crmError(err);
  }
}
