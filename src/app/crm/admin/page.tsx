// User administration.
//
// Gated by getSuperUser(), which fails CLOSED — unlike CRM access, which opens
// to every signed-in user when CRM_ADMINS is unset. A missing environment
// variable must not hand account control to whoever registers next.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminUsers } from "@/components/crm/AdminUsers";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { getSuperUser } from "@/lib/crm/access";
import { listUsers } from "@/lib/crm/admin";

export const metadata: Metadata = {
  title: "Users",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // 404 rather than 403: a non-superuser learns nothing about whether this
  // page exists.
  const session = await getSuperUser();
  if (!session) notFound();

  const users = await listUsers();

  return (
    <>
      <RecordHeader
        eyebrow="Administration"
        title="Users"
        intro="Everyone who can sign in, and what to do about it."
        breadcrumb={[{ href: "/crm", label: "CRM" }]}
      />
      <section className="section pt-12">
        <div className="container-x">
          <AdminUsers initial={users} currentEmail={session.sub} />
        </div>
      </section>
    </>
  );
}
