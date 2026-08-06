"use client";

/**
 * "What should we be doing?" — AI-proposed cards for the shared board.
 *
 * Same contract as everything else in the AI layer: it proposes, a person
 * presses, and the card is then created through the ordinary POST /api/crm/todos
 * that the board's own Add box uses. Nothing appears on the board that somebody
 * did not put there.
 *
 * It does NOT run on mount. The board is the screen the team opens every
 * morning, and a model call on every one of those opens is both a bill and
 * several seconds of latency on the one page that has to feel instant.
 *
 * The suggestions are generated against the whole book — see `suggestTodos` in
 * lib/crm/assist.ts, which loads the clients and the cards already on the board
 * and tells the model not to repeat what is there.
 */

import { useState } from "react";
import type { TodoStatus } from "@/lib/crm/types";
import { LABELS } from "@/lib/crm/types";
import { SparkleIcon } from "./AiAssist";
import { apiPost } from "./api";
import { ErrorNote } from "./ui";

interface CardSuggestion {
  title: string;
  notes: string;
  status: TodoStatus;
  why: string;
}

export function AiSuggestCards({
  onAdd,
}: {
  /** Creates the card and puts it on the board. Throws to report a failure. */
  onAdd: (card: { title: string; notes: string; status: TodoStatus }) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cards, setCards] = useState<CardSuggestion[] | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError("");
    setAdded(new Set());
    try {
      const res = await apiPost<{ cards: CardSuggestion[] }>("/api/crm/assist", {
        kind: "todos",
        scope_type: "global",
      });
      setCards(res.cards ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not suggest anything.");
    } finally {
      setLoading(false);
    }
  }

  async function add(card: CardSuggestion) {
    setAdding(card.title);
    setError("");
    try {
      await onAdd({ title: card.title, notes: card.notes, status: card.status });
      setAdded((prev) => new Set(prev).add(card.title));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that card.");
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void run()} disabled={loading} className="sf-btn-ai">
          <SparkleIcon />
          {loading ? "Reading the book…" : "Suggest what's next"}
        </button>
        {cards ? (
          <button type="button" onClick={() => setCards(null)} className="sf-btn-ghost text-xs">
            Clear
          </button>
        ) : null}
      </div>

      <ErrorNote>{error}</ErrorNote>

      {cards ? (
        <div className="animate-pop-in mt-3 rounded-card border border-sf-200 bg-sf-50 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-sf-700">
            Proposed — nothing is on the board until you add it
          </p>

          {cards.length === 0 ? (
            <p className="text-sm text-ink-600">
              Nothing to propose: the board already covers what the record suggests.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {cards.map((card) => {
                const done = added.has(card.title);
                return (
                  <li
                    key={card.title}
                    className={`rounded-pill border border-ink-200 bg-card p-3 ${
                      done ? "opacity-55" : ""
                    }`}
                  >
                    <p className="text-sm font-medium leading-snug text-ink-900">{card.title}</p>
                    {card.notes ? (
                      <p className="mt-1 text-xs leading-relaxed text-ink-700">{card.notes}</p>
                    ) : null}
                    {/* The reason is the reviewable part. A card whose "why"
                        does not hold up is a card not to add. */}
                    <p className="mt-1.5 text-xs italic leading-relaxed text-ink-500">{card.why}</p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void add(card)}
                        disabled={done || adding === card.title}
                        className="sf-btn-neutral text-xs"
                      >
                        {done ? "Added" : adding === card.title ? "Adding…" : "Add to board"}
                      </button>
                      <span className="sf-meta">{LABELS.todoStatus[card.status]}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
