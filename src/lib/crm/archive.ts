// Archiving proposals and contracts.
//
// Withdraw, not destroy. A proposal drafted against the wrong client, or a
// contract set generated twice, is a mistake to take off the board — but the row
// may already be referenced by the activity feed, and somebody will eventually
// ask what happened to it. Deleting answers that question with silence.
//
// `archived_at` is deliberately NOT a status value. Status says where a document
// stands — draft, sent, accepted, signed — and folding "archived" into that enum
// would erase the fact that a withdrawn proposal had been accepted, which is
// exactly the thing you want to know when it resurfaces.

import { CrmError, logActivity, nowIso, query, queryOne } from "./db";

/** The two things that can be archived. Anything else is a programming error. */
const TABLES = {
  proposal: { table: "crm_proposals", entity: "Proposal", describe: "title" },
  contract: { table: "crm_contracts", entity: "Contract", describe: "title" },
} as const;

export type ArchivableKind = keyof typeof TABLES;

export interface ArchivedRow {
  id: string;
  kind: ArchivableKind;
  title: string;
  status: string;
  client_id: string;
  client_name: string | null;
  archived_at: string;
  archived_by: string | null;
  created_at: string;
}

export function isArchivableKind(v: unknown): v is ArchivableKind {
  return typeof v === "string" && v in TABLES;
}

/**
 * Archive or restore one row.
 *
 * Idempotent on purpose: archiving something already archived must not rewrite
 * who archived it or when, because that is the record of what happened.
 */
export async function setArchived(
  kind: ArchivableKind,
  id: string,
  archived: boolean,
  actor?: string | null,
): Promise<void> {
  const def = TABLES[kind];
  const now = nowIso();

  const row = archived
    ? await queryOne<{ id: string; title: string }>(
        `UPDATE ${def.table}
            SET archived_at = COALESCE(archived_at, $2),
                archived_by = COALESCE(archived_by, $3),
                updated_at  = $2
          WHERE id = $1
          RETURNING id, ${def.describe} AS title`,
        [id, now, actor ?? null],
      )
    : await queryOne<{ id: string; title: string }>(
        `UPDATE ${def.table}
            SET archived_at = NULL, archived_by = NULL, updated_at = $2
          WHERE id = $1
          RETURNING id, ${def.describe} AS title`,
        [id, now],
      );

  if (!row) throw new CrmError(`${def.entity} not found.`, 404);

  await logActivity({
    entity_type: def.table,
    entity_id: id,
    client_id: null,
    verb: archived ? "archived" : "restored",
    summary: `${archived ? "Archived" : "Restored"} ${def.entity.toLowerCase()} "${row.title}"`,
    actor_email: actor,
  });
}

/**
 * Everything currently archived, newest first.
 *
 * One query per table rather than a UNION so each keeps its own column names;
 * they are only merged for display.
 */
export async function listArchived(): Promise<ArchivedRow[]> {
  const [proposals, contracts] = await Promise.all([
    query<Omit<ArchivedRow, "kind">>(
      `SELECT p.id, p.title, p.status, p.client_id, c.name AS client_name,
              p.archived_at, p.archived_by, p.created_at
         FROM crm_proposals p
         LEFT JOIN crm_clients c ON c.id = p.client_id
        WHERE p.archived_at IS NOT NULL
        ORDER BY p.archived_at DESC LIMIT 200`,
    ),
    query<Omit<ArchivedRow, "kind">>(
      `SELECT k.id, k.title, k.status, k.client_id, c.name AS client_name,
              k.archived_at, k.archived_by, k.created_at
         FROM crm_contracts k
         LEFT JOIN crm_clients c ON c.id = k.client_id
        WHERE k.archived_at IS NOT NULL
        ORDER BY k.archived_at DESC LIMIT 200`,
    ),
  ]);

  return [
    ...proposals.map((r) => ({ ...r, kind: "proposal" as const })),
    ...contracts.map((r) => ({ ...r, kind: "contract" as const })),
  ].sort((a, b) => b.archived_at.localeCompare(a.archived_at));
}
