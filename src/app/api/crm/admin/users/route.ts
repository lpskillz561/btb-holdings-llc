import { NextResponse, type NextRequest } from "next/server";
import { requireSuperUser } from "@/lib/crm/access";
import { blockUser, listUsers, removeUser, resetPassword, unblockUser } from "@/lib/crm/admin";
import { CrmError } from "@/lib/crm/db";
import { crmError, readBody } from "@/lib/crm/rest";

export const runtime = "nodejs";

// One endpoint with an action in the body rather than a path per verb.
// The subject of every call is an email address, and putting one in a URL
// segment means dealing with encoding for '@', '+' and '.', on a route where a
// mis-parsed identifier would target the wrong account.

export async function GET(req: NextRequest) {
  try {
    await requireSuperUser(req);
    return NextResponse.json(await listUsers());
  } catch (err) {
    return crmError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSuperUser(req);
    const body = await readBody(req);
    const action = String(body.action ?? "");
    const email = String(body.email ?? "").trim();
    if (!email) throw new CrmError("An email is required.", 400);

    switch (action) {
      case "block": {
        const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
        await blockUser(email, reason, session.sub);
        return NextResponse.json({ ok: true });
      }
      case "unblock":
        await unblockUser(email, session.sub);
        return NextResponse.json({ ok: true });
      case "reset": {
        // The only time this value exists anywhere. Not logged, not stored.
        const temporary = await resetPassword(email, session.sub);
        return NextResponse.json({ ok: true, temporary_password: temporary });
      }
      case "remove":
        await removeUser(email, session.sub);
        return NextResponse.json({ ok: true });
      default:
        throw new CrmError("Unknown action.", 400);
    }
  } catch (err) {
    return crmError(err);
  }
}
