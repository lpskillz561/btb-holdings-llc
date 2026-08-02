import { CONTACTS } from "@/lib/crm/resource";
import { collectionHandlers } from "@/lib/crm/rest";

export const runtime = "nodejs";

const handlers = collectionHandlers(CONTACTS);
export const GET = handlers.GET;
export const POST = handlers.POST;
