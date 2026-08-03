import { NextResponse } from "next/server";
import { deleteTodo, updateTodo } from "@/lib/crm/todos";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const PATCH = withCrmParams<{ id: string }>(async (req, { actor, params }) => {
  const body = await readBody(req);
  const row = await updateTodo(params.id, { title: body.title, status: body.status }, actor);
  return NextResponse.json(row);
});

export const DELETE = withCrmParams<{ id: string }>(async (_req, { params }) => {
  await deleteTodo(params.id);
  return new NextResponse(null, { status: 204 });
});
