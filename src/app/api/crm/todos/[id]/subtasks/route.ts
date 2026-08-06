// One card's subtasks.
//
// Written by hand rather than through ./resource for the same reason the card
// itself is: `created_by` and `done_by` are stamped from the session, so "who
// finished this" is a fact rather than a claim the client made about itself.

import { NextResponse } from "next/server";
import { createSubtask, listSubtasks } from "@/lib/crm/todos";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const GET = withCrmParams<{ id: string }>(async (_req, { params }) => {
  return NextResponse.json(await listSubtasks(params.id));
});

export const POST = withCrmParams<{ id: string }>(async (req, { params, actor }) => {
  const body = await readBody(req);
  const row = await createSubtask(params.id, body.title, body.assignee, actor);
  return NextResponse.json(row, { status: 201 });
});
