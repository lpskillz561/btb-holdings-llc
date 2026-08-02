import { UNITS } from "@/lib/crm/resource";
import { itemHandlers } from "@/lib/crm/rest";

export const runtime = "nodejs";

const handlers = itemHandlers(UNITS);
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
