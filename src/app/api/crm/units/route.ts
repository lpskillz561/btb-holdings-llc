import { UNITS } from "@/lib/crm/resource";
import { collectionHandlers } from "@/lib/crm/rest";

export const runtime = "nodejs";

const handlers = collectionHandlers(UNITS);
export const GET = handlers.GET;
export const POST = handlers.POST;
