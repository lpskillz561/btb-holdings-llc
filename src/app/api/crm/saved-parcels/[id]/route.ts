// Status and notes on a shortlisted parcel. Saving one is POST /api/crm/land/save
// (it copies a snapshot out of the parcel database), so there is no collection
// POST here — only the operator's edits and removal.

import { SAVED_PARCELS } from "@/lib/crm/resource";
import { itemHandlers } from "@/lib/crm/rest";

export const runtime = "nodejs";

const handlers = itemHandlers(SAVED_PARCELS);
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
