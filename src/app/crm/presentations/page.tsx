// The presentation library — every deck we show a client, in one place.
//
// Note the route name. `isClientFacingRoute` strips the CRM chrome from the
// deck itself at /crm/present, and this page is /crm/presentATIONS: it is an
// internal screen and MUST keep its nav. That is why the guard in
// lib/crm/routes.ts matches "/crm/present/" with a trailing slash rather than a
// bare prefix — a `startsWith("/crm/present")` would swallow this page and the
// first anyone would notice is a presenter with no way back to the CRM.
//
// Everything here links OUT to the deck in a new tab, deliberately: the
// presenter shares that one tab in Meet and keeps this page — which lists the
// whole book — behind it.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordHeader } from "@/components/crm/RecordHeader";
import { Badge, EmptyState, SectionHeading, Table, Td } from "@/components/crm/ui";
import { buildSlides } from "@/components/present/slides";
import { getCrmPageUser } from "@/lib/crm/access";
import { listClients } from "@/lib/crm/clients";
import { DECK_TRACKS, DECKS, type DeckTrack } from "@/lib/crm/decks";
import { fmtMoney } from "@/lib/crm/format";
import { buildPresentationFigures } from "@/lib/crm/presentation";
import { statusTone } from "@/lib/crm/tone";
import { LABELS } from "@/lib/crm/types";

export const metadata: Metadata = {
  title: "Presentations",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function deckHref(track: DeckTrack, clientId?: string) {
  return `/crm/present?track=${track}${clientId ? `&client=${encodeURIComponent(clientId)}` : ""}`;
}

export default async function PresentationsPage() {
  const user = await getCrmPageUser();
  if (!user) notFound();

  // Titles come from building the deck rather than being listed here, so the
  // contents shown on this page cannot drift from the deck that opens. The
  // generic figures are thrown away — only `slide.title` is read.
  const generic = buildPresentationFigures(null);
  const contents = Object.fromEntries(
    DECK_TRACKS.map((track) => [track, buildSlides(generic, { track }).map((s) => s.title)]),
  ) as Record<DeckTrack, string[]>;

  const clients = await listClients().catch(() => []);

  return (
    <>
      <RecordHeader
        eyebrow="Client-facing"
        title="Presentations"
        intro="The decks we show on a call. Every figure on every slide is computed from the same deal terms the contract uses, so a slide cannot disagree with what we then sign."
        actions={
          <a href={deckHref("first-call")} target="_blank" rel="noopener" className="sf-btn-brand shrink-0">
            Open first call
          </a>
        }
      />

      <section className="section pt-12">
        <div className="container-x space-y-10">
          <div className="grid gap-5 lg:grid-cols-2">
            {DECK_TRACKS.map((track) => {
              const deck = DECKS[track];
              return (
                <div key={track} className="sf-card flex flex-col p-6">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-base font-semibold text-ink-900">{deck.label}</h2>
                    <Badge tone={track === "first-call" ? "gold" : "neutral"}>
                      {contents[track].length} slides
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-ink-800">{deck.blurb}</p>
                  <p className="mt-3 text-sm leading-relaxed text-ink-600">{deck.when}</p>

                  <ol className="mt-5 space-y-1.5 border-t border-ink-200 pt-4 text-sm">
                    {contents[track].map((title, i) => (
                      <li key={`${title}-${i}`} className="flex gap-3">
                        <span className="tabular-nums text-ink-900/35">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-ink-800">{title}</span>
                      </li>
                    ))}
                  </ol>

                  <div className="mt-6 flex-1" />
                  <a
                    href={deckHref(track)}
                    target="_blank"
                    rel="noopener"
                    className={track === "first-call" ? "sf-btn-brand" : "sf-btn-neutral"}
                  >
                    Open {deck.label.toLowerCase()}
                  </a>
                </div>
              );
            })}
          </div>

          <div>
            <SectionHeading title="Present to a client" count={clients.length} />
            <p className="mb-4 max-w-3xl text-sm text-ink-600">
              Opening a deck against a client puts their name on the title slide and sizes the
              terms to the deduction on their record. Without a target deduction the deck falls
              back to the executed sample and the tier table — never an invented number.
            </p>
            <div className="card">
              {clients.length === 0 ? (
                <div className="p-6">
                  <EmptyState>
                    No clients yet. The decks above open unpersonalised in the meantime.
                  </EmptyState>
                </div>
              ) : (
                <Table head={["Client", "Stage", "Target deduction", "Present"]}>
                  {clients.map((row) => (
                    <tr key={row.id} className="transition hover:bg-paper-50">
                      <Td>
                        <Link
                          href={`/crm/clients/${row.id}`}
                          className="font-semibold text-ink-900 hover:text-gold-600"
                        >
                          {row.name}
                        </Link>
                      </Td>
                      <Td>
                        <Badge tone={statusTone(row.status)}>{LABELS.clientStatus[row.status]}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {row.target_writeoff_cents ? (
                          fmtMoney(row.target_writeoff_cents)
                        ) : (
                          <span className="text-ink-900/40">Not set</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <a
                          href={deckHref("first-call", row.id)}
                          target="_blank"
                          rel="noopener"
                          className="font-medium text-sf-600 hover:underline"
                        >
                          First call
                        </a>
                        <span className="px-2 text-ink-900/25">·</span>
                        <a
                          href={deckHref("full", row.id)}
                          target="_blank"
                          rel="noopener"
                          className="font-medium text-sf-600 hover:underline"
                        >
                          Full deck
                        </a>
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
