"use client";

/**
 * The presentation shell — full-screen, keyboard-driven, built to be screen-shared.
 *
 * Three things drive the design, and all three come from the room rather than
 * from the browser:
 *
 * 1. **One slide is one DOM subtree that is always mounted.** Slides are hidden
 *    with CSS, not unmounted, so moving between them cannot flash, re-request an
 *    image, or drop a scroll position mid-sentence in front of a client.
 * 2. **Fullscreen needs a user gesture.** Browsers refuse `requestFullscreen()`
 *    outside a click, so there is a deliberate start button rather than an
 *    attempt on mount that fails silently and leaves the presenter looking at
 *    browser chrome on a shared screen.
 * 3. **A conference call eats the pointer.** Every control has a key: arrows and
 *    space to move, F for fullscreen, O for the slide list, Esc to back out. The
 *    presenter should never have to find a small target while talking.
 *
 * The deck is deliberately NOT responsive-first. It is laid out for a projected
 * 16:9 surface and scaled to fit, so what the presenter sees on a laptop is what
 * the room sees.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface Slide {
  id: string;
  /** Shown in the jump list and the progress rail, not on the slide itself. */
  title: string;
  node: React.ReactNode;
}

export function Deck({
  slides,
  trackLabel,
  startAside,
}: {
  slides: Slide[];
  /** Which deck this is, named on the start gate so the wrong one is caught. */
  trackLabel?: string;
  /**
   * Rendered under the start button — the track switch lives here rather than
   * inside this component, which knows nothing about what a track is. It is on
   * the START GATE and nowhere else: once the presenter has begun, the tab is
   * being screen-shared, and a control that lists our other decks is our
   * tooling appearing in front of a prospect.
   */
  startAside?: React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [started, setStarted] = useState(false);
  const [overview, setOverview] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (next: number) => setIndex(Math.max(0, Math.min(slides.length - 1, next))),
    [slides.length],
  );

  const enterFullscreen = useCallback(async () => {
    try {
      await rootRef.current?.requestFullscreen?.();
    } catch {
      // Denied or unsupported — the deck still works in a maximised window, and
      // a presenter mid-pitch must not get an error dialog.
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else {
      await enterFullscreen();
    }
  }, [enterFullscreen]);

  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!started) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void enterFullscreen().then(() => setStarted(true));
        }
        return;
      }
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case " ":
        case "PageDown":
          e.preventDefault();
          if (overview) return;
          go(index + 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          e.preventDefault();
          if (overview) return;
          go(index - 1);
          break;
        case "Home":
          e.preventDefault();
          go(0);
          break;
        case "End":
          e.preventDefault();
          go(slides.length - 1);
          break;
        case "f":
        case "F":
          e.preventDefault();
          void toggleFullscreen();
          break;
        case "o":
        case "O":
          e.preventDefault();
          setOverview((v) => !v);
          break;
        case "Escape":
          // Esc already exits fullscreen at the browser level; here it only has
          // to close the jump list, or the presenter loses fullscreen when they
          // meant to dismiss a menu.
          if (overview) {
            e.preventDefault();
            setOverview(false);
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, overview, index, go, slides.length, toggleFullscreen, enterFullscreen]);

  const current = slides[index];

  return (
    <div ref={rootRef} className="deck-root relative min-h-screen bg-navy-900 text-paper-50">
      {/* ---- The start gate. Also the only place fullscreen can be requested. */}
      {!started ? (
        <div className="flex min-h-screen items-center justify-center px-6">
          <div className="max-w-xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-500">
              BTB Holdings
            </p>
            <h1 className="mt-4 font-serif text-4xl font-medium">
              {trackLabel ?? "Client presentation"}
            </h1>
            <p className="mt-4 text-paper-50/70">
              {slides.length} slides. Arrow keys or space to move, <kbd className="deck-kbd">F</kbd>{" "}
              for fullscreen, <kbd className="deck-kbd">O</kbd> for the slide list.
            </p>
            <button
              type="button"
              onClick={() => void enterFullscreen().then(() => setStarted(true))}
              className="mt-8 rounded-md bg-gold-500 px-7 py-3 text-base font-semibold text-navy-950 transition hover:bg-gold-400"
            >
              Start presentation
            </button>
            <p className="mt-4 text-sm text-paper-50/45">
              Share this tab in Google Meet once it is fullscreen.
            </p>
            {startAside}
          </div>
        </div>
      ) : (
        <>
          {/* ---- Slides. All mounted; only one visible. */}
          <div className="deck-stage">
            {slides.map((slide, i) => (
              <section
                key={slide.id}
                aria-hidden={i !== index}
                className={`deck-slide ${i === index ? "deck-slide-current" : ""}`}
              >
                <div className="deck-canvas">{slide.node}</div>
              </section>
            ))}
          </div>

          {/* ---- Controls. Recessive until the pointer is near them: a visible
                  toolbar in a screen share is a distraction on every slide. */}
          <div className="deck-controls">
            <button
              type="button"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              className="deck-btn"
              aria-label="Previous slide"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => setOverview((v) => !v)}
              className="deck-btn"
              aria-label="All slides"
            >
              {index + 1} / {slides.length}
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              disabled={index === slides.length - 1}
              className="deck-btn"
              aria-label="Next slide"
            >
              →
            </button>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              className="deck-btn"
              aria-label={isFull ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFull ? "⤡" : "⤢"}
            </button>
          </div>

          {/* ---- Progress. One hairline; it tells the room how much is left
                  without putting a number on every slide. */}
          <div className="deck-progress" aria-hidden>
            <div
              className="deck-progress-fill"
              style={{ width: `${((index + 1) / slides.length) * 100}%` }}
            />
          </div>

          {/* ---- Jump list. */}
          {overview ? (
            <div className="deck-overview" role="dialog" aria-label="All slides">
              <div className="deck-overview-inner">
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-gold-500">
                  Slides
                </p>
                <ol className="grid gap-1 sm:grid-cols-2">
                  {slides.map((slide, i) => (
                    <li key={slide.id}>
                      <button
                        type="button"
                        onClick={() => {
                          go(i);
                          setOverview(false);
                        }}
                        className={`w-full rounded px-3 py-2 text-left text-sm transition hover:bg-white/10 ${
                          i === index ? "bg-white/10 font-semibold" : "text-paper-50/75"
                        }`}
                      >
                        <span className="mr-3 tabular-nums text-paper-50/40">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        {slide.title}
                      </button>
                    </li>
                  ))}
                </ol>
                <p className="mt-5 text-xs text-paper-50/45">
                  Esc closes this. <kbd className="deck-kbd">F</kbd> toggles fullscreen.
                </p>
              </div>
            </div>
          ) : null}

          <span className="sr-only" aria-live="polite">
            Slide {index + 1} of {slides.length}: {current?.title}
          </span>
        </>
      )}
    </div>
  );
}
