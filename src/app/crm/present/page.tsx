// The client presentation.
//
// It lives under /crm because that is what gates it: the middleware matcher
// covers /crm/:path*, and `getCrmPageUser` 404s anyone without CRM access. A
// top-level /present would be outside the matcher and therefore PUBLIC — the
// deck names our terms, our deposit and our authorities, and it is not for the
// open internet.
//
// It looks nothing like the rest of /crm, on purpose. Everything under /crm is
// Salesforce Lightning because that is what staff read fastest; this is shown to
// a taxpayer and their CPA, where the navy/gold brand is worth more than
// familiar software. `CrmChrome` and `AskAi` both render nothing here, the same
// way they render nothing on a /print route.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Deck } from "@/components/present/Deck";
import { buildSlides } from "@/components/present/slides";
import { getCrmPageUser } from "@/lib/crm/access";
import { getClient } from "@/lib/crm/clients";
import { buildPresentationFigures } from "@/lib/crm/presentation";

export const metadata: Metadata = {
  title: "Presentation",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function PresentPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const { client: clientId } = await searchParams;

  // Personalisation is best-effort. A deck that fails to open because one
  // lookup was unhappy is worse than a deck without the prospect's name on it,
  // and this is opened moments before a call.
  const client = clientId ? await getClient(clientId).catch(() => null) : null;

  const figures = buildPresentationFigures(client?.target_writeoff_cents ?? null);
  const slides = buildSlides(figures, { clientName: client?.legal_name || client?.name || null });

  return <Deck slides={slides} />;
}
