import { NextResponse } from "next/server";
import { toPromptScope } from "@/lib/crm/advisor";
import {
  assistText,
  isAssistKind,
  isTextAction,
  suggestFields,
  suggestTodos,
  triageClients,
  type AssistField,
} from "@/lib/crm/assist";
import { CrmError } from "@/lib/crm/db";
import { readBody, withCrm } from "@/lib/crm/rest";

export const runtime = "nodejs";
// A field sweep reads the whole client context and the knowledge base before it
// generates. Same ceiling as the advisor, for the same reason.
export const maxDuration = 120;

/**
 * One POST behind every inline AI control in the CRM.
 *
 * It is deliberately a SINGLE route with a `kind` rather than four routes: the
 * auth gate, the scope parsing and the error translation are identical for all
 * of them, and four copies of `withCrm(...)` is four places for one of them to
 * drift out of the allow-list.
 *
 * **This route never writes.** Every branch returns a suggestion and stops.
 * Applying one is the browser calling the ordinary POST/PATCH endpoints, which
 * have their own coercers and their own allow-list in lib/crm/resource.ts — so a
 * suggestion cannot reach the database without passing every check a typed value
 * passes. That is what makes "propose, then confirm" a property of the system
 * rather than a convention.
 *
 * `/api` is outside the middleware matcher, so `withCrm` is the only gate here.
 */
export const POST = withCrm(async (req) => {
  const body = await readBody(req);
  const kind = body.kind;
  if (!isAssistKind(kind)) {
    throw new CrmError(
      `Unknown assist kind. Expected one of: fields, text, todos, triage.`,
      400,
    );
  }

  const scope = toPromptScope(body.scope_type, body.scope_id);

  switch (kind) {
    case "fields": {
      const fields = Array.isArray(body.fields) ? (body.fields as AssistField[]) : [];
      if (!fields.length) throw new CrmError("No fields were sent to fill in.", 400);
      return NextResponse.json(
        await suggestFields({
          scope,
          fields,
          current: (body.current ?? {}) as Record<string, string>,
          formTitle: body.form_title ? String(body.form_title) : undefined,
          hint: body.hint ? String(body.hint) : undefined,
        }),
      );
    }

    case "text": {
      const action = body.action;
      if (!isTextAction(action)) {
        throw new CrmError(
          "Unknown text action. Expected one of: tidy, brief, expand, actions, check.",
          400,
        );
      }
      return NextResponse.json(
        await assistText({
          scope,
          action,
          text: String(body.text ?? ""),
          label: body.label ? String(body.label) : undefined,
        }),
      );
    }

    case "todos":
      return NextResponse.json(
        await suggestTodos({ scope, hint: body.hint ? String(body.hint) : undefined }),
      );

    case "triage":
      return NextResponse.json(
        await triageClients({ hint: body.hint ? String(body.hint) : undefined }),
      );
  }
});
