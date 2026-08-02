// Route plumbing shared by every /api/crm endpoint: auth, body parsing, and a
// single error translation so a CrmError's status reaches the client and an
// unexpected failure never leaks a stack trace or a SQL string.

import { NextResponse, type NextRequest } from "next/server";
import { requireCrmApiUser } from "./access";
import { CrmError } from "./db";
import {
  createRow,
  deleteRow,
  getRow,
  listRows,
  updateRow,
  type ResourceDef,
} from "./resource";

/** Next 15 hands dynamic segments to route handlers as a promise. */
export type RouteContext<T extends Record<string, string>> = { params: Promise<T> };

export function crmError(err: unknown): NextResponse {
  if (err instanceof CrmError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Anything else is a bug or an outage: log it in full, tell the caller nothing.
  console.error("crm api error", err);
  const message =
    err instanceof Error && /OPENAI_API_KEY|DATABASE_URL/.test(err.message)
      ? err.message
      : "Something went wrong. Please try again.";
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Parse a JSON body, treating an empty or malformed one as `{}` rather than a crash. */
export async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Wrap a collection handler (no dynamic segment) with the CRM session check and
 * error translation. Every route in this app goes through one of these two
 * wrappers — /api is outside the middleware's matcher, so this is the only
 * thing standing between an anonymous request and the data.
 *
 * There are two wrappers rather than one optional-argument wrapper because
 * Next.js validates each exported handler's second parameter against the route
 * shape: a segment-less route must not declare one at all.
 */
export function withCrm(
  handler: (req: NextRequest, ctx: { actor: string }) => Promise<NextResponse>,
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      const session = await requireCrmApiUser(req);
      return await handler(req, { actor: session.sub });
    } catch (err) {
      return crmError(err);
    }
  };
}

/** The same, for a route with dynamic segments (`[id]`). */
export function withCrmParams<T extends Record<string, string>>(
  handler: (req: NextRequest, ctx: { actor: string; params: T }) => Promise<NextResponse>,
) {
  return async (req: NextRequest, routeCtx: { params: Promise<T> }): Promise<NextResponse> => {
    try {
      const session = await requireCrmApiUser(req);
      return await handler(req, { actor: session.sub, params: await routeCtx.params });
    } catch (err) {
      return crmError(err);
    }
  };
}

/** GET (list) + POST (create) for a resource. */
export function collectionHandlers(def: ResourceDef) {
  return {
    GET: withCrm(async (req) => {
      const rows = await listRows(def, req.nextUrl.searchParams);
      return NextResponse.json(rows);
    }),
    POST: withCrm(async (req, { actor }) => {
      const row = await createRow(def, await readBody(req), actor);
      return NextResponse.json(row, { status: 201 });
    }),
  };
}

/** GET + PATCH + DELETE for one record of a resource. */
export function itemHandlers(def: ResourceDef) {
  return {
    GET: withCrmParams<{ id: string }>(async (_req, { params }) => {
      return NextResponse.json(await getRow(def, params.id));
    }),
    PATCH: withCrmParams<{ id: string }>(async (req, { actor, params }) => {
      const row = await updateRow(def, params.id, await readBody(req), actor);
      return NextResponse.json(row);
    }),
    DELETE: withCrmParams<{ id: string }>(async (_req, { actor, params }) => {
      await deleteRow(def, params.id, actor);
      return new NextResponse(null, { status: 204 });
    }),
  };
}
