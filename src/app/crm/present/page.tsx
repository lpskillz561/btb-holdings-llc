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
import Link from "next/link";
import { notFound } from "next/navigation";
import { Deck } from "@/components/present/Deck";
import { buildSlides } from "@/components/present/slides";
import { getCrmPageUser } from "@/lib/crm/access";
import { getClient } from "@/lib/crm/clients";
import { DECK_TRACKS, DECKS, parseTrack } from "@/lib/crm/decks";
import { buildPresentationFigures } from "@/lib/crm/presentation";

export const metadata: Metadata = {
  title: "Presentation",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function PresentPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; track?: string }>;
}) {
  const user = await getCrmPageUser();
  if (!user) notFound();

  const { client: clientId, track: rawTrack } = await searchParams;
  // An unrecognised track falls back rather than 404ing. This URL is opened
  // moments before a call, sometimes from a typed address; the deck opening on
  // the wrong track is recoverable in one click on the start gate, and a 404 is
  // not recoverable at all.
  const track = parseTrack(rawTrack);

  // Personalisation is best-effort. A deck that fails to open because one
  // lookup was unhappy is worse than a deck without the prospect's name on it,
  // and this is opened moments before a call.
  const client = clientId ? await getClient(clientId).catch(() => null) : null;

  const figures = buildPresentationFigures(client?.target_writeoff_cents ?? null);
  const slides = buildSlides(figures, {
    clientName: client?.legal_name || client?.name || null,
    track,
  });

  const href = (t: string) =>
    `/crm/present?track=${t}${clientId ? `&client=${encodeURIComponent(clientId)}` : ""}`;

  return (
    <Deck
      slides={slides}
      trackLabel={DECKS[track].label}
      startAside={
        <div className="mt-8 border-t border-white/10 pt-5">
          <p className="text-xs uppercase tracking-[0.18em] text-paper-50/40">Switch deck</p>
          <div className="mt-3 flex justify-center gap-2">
            {DECK_TRACKS.map((option) => (
              <Link
                key={option}
                href={href(option)}
                aria-current={option === track ? "true" : undefined}
                className={`rounded-md px-4 py-2 text-sm transition ${
                  option === track
                    ? "bg-white/12 font-semibold text-paper-50"
                    : "text-paper-50/60 hover:bg-white/8 hover:text-paper-50"
                }`}
              >
                {DECKS[option].label}
              </Link>
            ))}
          </div>
          <p className="mx-auto mt-3 max-w-sm text-xs leading-relaxed text-paper-50/45">
            {DECKS[track].blurb}
          </p>
        </div>
      }
    />
  );
}
