// The shared kanban board.
//
// It used to sit on the dashboard, fenced off with rules top and bottom because
// it was the one editable block on a screen of read-only reporting. That fence
// was the tell: a thing that has to be walled off from the page it is on wants
// its own page. The dashboard now carries a short read-only list that links
// here, and the board gets the full width a three-column board actually needs.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { TodoBoard } from "@/components/crm/TodoBoard";
import { getCrmPageUser } from "@/lib/crm/access";
import { listAssignableUsers, listTodos } from "@/lib/crm/todos";

export const metadata: Metadata = {
  title: "Board",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function TodosPage() {
  const user = await getCrmPageUser();
  if (!user) notFound();

  // Neither of these may take the page down: an empty board is a working board,
  // and an assignee list that failed to load still leaves every card readable.
  const [todos, users] = await Promise.all([
    listTodos().catch(() => []),
    listAssignableUsers().catch(() => []),
  ]);

  return (
    <>
      <RecordHeader
        eyebrow="Team"
        title="Board"
        intro="One board for the whole office. Everyone sees the same cards, and everyone can move, assign and comment on them."
      />
      <section className="section">
        <div className="container-x">
          {/* TodoBoard reads ?card= to open a card straight from a link, and
              useSearchParams needs a boundary to opt this subtree out of
              prerendering. */}
          <Suspense fallback={null}>
            <TodoBoard initial={todos} users={users} viewer={user.sub} />
          </Suspense>
        </div>
      </section>
    </>
  );
}
