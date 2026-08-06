"use client";

import { useState } from "react";
import type { AdminUser } from "@/lib/crm/admin";
import { fmtAgo, fmtDate } from "@/lib/crm/format";
import { Badge, EmptyState, ErrorNote, StatTile, TextInput } from "./ui";

/**
 * The controls for one account.
 *
 * Destructive actions confirm first, and the temporary password from a reset is
 * shown once, inline, in a panel that has to be dismissed — there is no second
 * chance to read it and no copy of it on the server.
 */
export function AdminUsers({
  initial,
  currentEmail,
}: {
  initial: AdminUser[];
  currentEmail: string;
}) {
  const [users, setUsers] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ email: string; password: string } | null>(null);

  const me = currentEmail.trim().toLowerCase();

  async function act(email: string, action: string, extra: Record<string, unknown> = {}) {
    setBusy(`${email}:${action}`);
    setError(null);
    try {
      const res = await fetch("/api/crm/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, action, ...extra }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "That did not work.");
        return;
      }
      if (action === "reset" && body.temporary_password) {
        setReveal({ email, password: body.temporary_password });
      }
      const listed = await fetch("/api/crm/admin/users");
      if (listed.ok) setUsers(await listed.json());
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const blocked = users.filter((u) => u.blocked_at).length;
  const envAccounts = users.filter((u) => u.env_account).length;
  // Registered, unblocked, and still 404ing on every CRM page. Nothing else on
  // this screen would tell you they exist.
  const pending = users.filter((u) => !u.crm_access && !u.blocked_at).length;

  return (
    <div className="space-y-8">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Registered users" value={String(users.length)} />
        <StatTile label="Blocked" value={String(blocked)} tone={blocked > 0 ? "gold" : undefined} />
        <StatTile
          label="Can sign in"
          value={String(users.length - blocked)}
          hint="Plus any AUTH_USERS accounts"
        />
        <StatTile
          label="Awaiting CRM access"
          value={String(pending)}
          tone={pending > 0 ? "gold" : undefined}
          hint="Signed up, but not on CRM_ADMINS yet"
        />
      </div>

      {/* The single most misleading thing about this screen, said up front. */}
      <div className="rounded-lg border border-ink-300 bg-ink-100 p-4 text-sm text-ink-700">
        <p>
          <strong className="text-ink-900">This lists registered accounts only.</strong> Built-in
          accounts from the <code>AUTH_USERS</code> environment variable — including the one you are
          signed in with — are checked by the login route <em>before</em> the database and do not
          appear here unless they have also registered. To change one, edit{" "}
          <code>/btb-crm/AUTH_USERS</code> in SSM and redeploy.
        </p>
        <p className="mt-3">
          <strong className="text-ink-900">Registering does not grant CRM access.</strong> A new
          account can sign in but sees nothing here until its email is added to{" "}
          <code>/btb-crm/CRM_ADMINS</code> in SSM, followed by a redeploy. Until then it lands on{" "}
          <code>/welcome</code> rather than a 404, and shows as <em>Awaiting access</em> below.
        </p>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {reveal ? (
        <div className="rounded-lg border border-accent-300 bg-accent-100/30 p-5">
          <p className="text-sm font-semibold text-ink-900">
            Temporary password for {reveal.email}
          </p>
          <p className="mt-2 font-mono text-lg text-ink-900">{reveal.password}</p>
          <p className="mt-2 text-xs text-ink-700">
            Shown once and stored nowhere. Copy it now, send it through a channel other than email
            if you can, and have them change it.
          </p>
          <button
            type="button"
            onClick={() => setReveal(null)}
            className="mt-3 rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-card-2"
          >
            I have copied it
          </button>
        </div>
      ) : null}

      {users.length === 0 ? (
        <EmptyState>
          Nobody has registered yet. Registration is controlled by{" "}
          <code>REGISTRATION_CODE</code>; leaving it unset keeps registration closed.
        </EmptyState>
      ) : (
        <div className="sf-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-100 text-left text-xs uppercase tracking-wide text-ink-600">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Email</th>
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-4 py-2.5 font-semibold">Registered</th>
                <th className="px-4 py-2.5 font-semibold">Last sign-in</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">CRM access</th>
                <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = u.email.toLowerCase() === me;
                const working = busy?.startsWith(`${u.email}:`);
                return (
                  <tr key={u.email} className="border-t border-ink-200 align-middle">
                    <td className="px-4 py-3 font-medium text-ink-900">
                      {u.email}
                      {isMe ? <span className="ml-2 text-xs text-ink-600">(you)</span> : null}
                    </td>
                    <td className="px-4 py-3">{u.name ?? "—"}</td>
                    <td className="px-4 py-3">{fmtDate(u.created_at)}</td>
                    <td className="px-4 py-3">
                      {u.last_login_at ? fmtAgo(u.last_login_at) : "never"}
                    </td>
                    <td className="px-4 py-3">
                      {u.env_account ? (
                        <Badge tone="navy">Built-in</Badge>
                      ) : u.blocked_at ? (
                        <Badge tone="red">Blocked</Badge>
                      ) : (
                        <Badge tone="green">Active</Badge>
                      )}
                      {u.blocked_reason ? (
                        <span className="ml-2 text-xs text-ink-600">{u.blocked_reason}</span>
                      ) : null}
                    </td>
                    {/* Separate from Status on purpose: an account can be
                        perfectly active and still 404 on every CRM page,
                        because signing in and CRM access are different gates. */}
                    <td className="px-4 py-3">
                      {u.crm_access ? (
                        <Badge tone="green">Yes</Badge>
                      ) : (
                        <Badge tone="gold">Awaiting access</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {u.env_account ? (
                          <span className="text-xs text-ink-500">Managed by AUTH_USERS</span>
                        ) : (
                          <>
                            {u.blocked_at ? (
                              <ActionButton
                                disabled={working}
                                onClick={() => act(u.email, "unblock")}
                              >
                                Unblock
                              </ActionButton>
                            ) : (
                              <ActionButton
                                disabled={working || isMe}
                                title={isMe ? "You cannot block your own account" : undefined}
                                onClick={() => {
                                  const reason = window.prompt(
                                    `Block ${u.email}? Optional reason:`,
                                    "",
                                  );
                                  // prompt returns null on cancel, "" on OK with
                                  // no text — only the former should abort.
                                  if (reason === null) return;
                                  act(u.email, "block", { reason });
                                }}
                              >
                                Block
                              </ActionButton>
                            )}
                            <ActionButton
                              disabled={working}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Reset the password for ${u.email}? Their current password stops working immediately.`,
                                  )
                                )
                                  act(u.email, "reset");
                              }}
                            >
                              Reset password
                            </ActionButton>
                            <ActionButton
                              danger
                              disabled={working || isMe}
                              title={isMe ? "You cannot remove your own account" : undefined}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Permanently remove ${u.email}? This cannot be undone.`,
                                  )
                                )
                                  act(u.email, "remove");
                              }}
                            >
                              Remove
                            </ActionButton>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  danger,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "border-err-500/30 text-err-700 hover:bg-err-50"
          : "border-ink-300 text-ink-900 hover:bg-ink-100"
      }`}
    >
      {children}
    </button>
  );
}
