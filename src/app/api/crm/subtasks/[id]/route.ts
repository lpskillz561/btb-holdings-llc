// One subtask: tick, reword, reassign, reorder, delete.
//
// Top-level rather than nested under the card, because every operation here
// identifies the subtask by its own id — a subtask cannot move between cards,
// so threading the parent through the URL would be a path segment nothing reads.

import { NextResponse } from "next/server";
import { deleteSubtask, updateSubtask } from "@/lib/crm/todos";
import { readBody, withCrmParams } from "@/lib/crm/rest";

export const runtime = "nodejs";

export const PATCH = withCrmParams<{ id: string }>(async (req, { actor, params }) => {
  const body = await readBody(req);
  // Absent key leaves the field alone; explicit null clears. Same PATCH
  // semantics as the rest of this API — see updateSubtask.
  const row = await updateSubtask(
    params.id,
    {
      title: body.title,
      done: body.done,
      assignee: body.assignee,
      position: body.position,
    },
    actor,
  );
  return NextResponse.json(row);
});

export const DELETE = withCrmParams<{ id: string }>(async (_req, { params }) => {
  await deleteSubtask(params.id);
  return new NextResponse(null, { status: 204 });
});
