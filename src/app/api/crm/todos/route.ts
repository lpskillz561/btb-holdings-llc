// The shared to-do list. Gated by withCrm like everything else under /api —
// every CRM user reads and writes the same list, by design.

import { NextResponse } from "next/server";
import { createTodo, listTodos } from "@/lib/crm/todos";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const GET = withCrm(async () => {
  return NextResponse.json(await listTodos());
});

export const POST = withCrm(async (req, { actor }) => {
  const body = await readBody(req);
  // `created_by` comes from the session, never the body.
  const row = await createTodo(body.title, actor);
  return NextResponse.json(row, { status: 201 });
});
