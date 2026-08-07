"use client";

/**
 * An emoji picker, hand-listed rather than installed.
 *
 * A full set is ~1,900 emoji plus keyword data, which is a ~100 KB dependency
 * shipped to the browser so that someone can find 🫠. This is the couple of
 * hundred people in an office actually use, each with the words they would
 * search for, and it costs a few kilobytes of the bundle it already ships.
 *
 * A note, because the codebase says the opposite elsewhere: the board's card
 * footer had its emoji REPLACED with drawn SVG, on the grounds that an emoji is
 * rendered by the OS at whatever weight it likes and looks different on every
 * machine. That rule is about UI CHROME — furniture the app draws, which has to
 * be consistent. This is the opposite case: emoji people type at each other are
 * content, and rendering them in the reader's own system font is exactly right.
 * The two are not in tension.
 */

import { useEffect, useMemo, useRef, useState } from "react";

interface Group {
  name: string;
  emoji: [string, string][];
}

/** [glyph, search words]. Keep the words plain — this is what people type. */
const GROUPS: Group[] = [
  {
    name: "Reactions",
    emoji: [
      ["👍", "thumbs up yes agree approve good ok"],
      ["👎", "thumbs down no disagree bad"],
      ["✅", "check tick done yes complete"],
      ["❌", "cross no wrong cancel"],
      ["🎉", "party tada celebrate win closed"],
      ["🔥", "fire hot great good"],
      ["👀", "eyes looking watching review"],
      ["🙏", "please thanks thank you pray"],
      ["💯", "hundred perfect agree"],
      ["🚀", "rocket ship launch fast go"],
      ["⚠️", "warning caution careful"],
      ["🛑", "stop halt blocked"],
      ["❤️", "heart love"],
      ["😂", "laugh funny lol joy"],
      ["🤔", "thinking hmm unsure question"],
      ["🙌", "hands celebrate praise"],
    ],
  },
  {
    name: "Faces",
    emoji: [
      ["😀", "grin happy smile"],
      ["😃", "happy smile"],
      ["😄", "happy smile laugh"],
      ["😁", "grin beam"],
      ["😅", "sweat nervous laugh phew"],
      ["🤣", "rolling laugh funny"],
      ["😊", "blush happy smile"],
      ["🙂", "slight smile"],
      ["😉", "wink"],
      ["😍", "love heart eyes"],
      ["😘", "kiss"],
      ["😎", "cool sunglasses"],
      ["🤩", "star struck wow amazing"],
      ["😐", "neutral meh"],
      ["😬", "grimace awkward yikes"],
      ["🙄", "eye roll"],
      ["😴", "sleep tired bored"],
      ["😢", "cry sad"],
      ["😭", "sob crying"],
      ["😤", "frustrated steam"],
      ["😡", "angry mad"],
      ["🤯", "mind blown shocked"],
      ["😱", "scream shocked scared"],
      ["🥳", "party celebrate birthday"],
      ["🤝", "handshake deal agreement"],
      ["👋", "wave hi hello bye"],
      ["🤞", "fingers crossed hope luck"],
      ["💪", "strong muscle"],
    ],
  },
  {
    name: "Work",
    emoji: [
      ["📌", "pin important"],
      ["📎", "clip attachment"],
      ["📝", "note memo write"],
      ["📄", "document page paper"],
      ["📁", "folder file"],
      ["📊", "chart bar figures data"],
      ["📈", "chart up growth increase"],
      ["📉", "chart down decrease loss"],
      ["🗓️", "calendar date schedule"],
      ["⏰", "alarm time deadline"],
      ["⌛", "hourglass waiting time"],
      ["✍️", "sign signature write"],
      ["🔍", "search look find magnify"],
      ["💡", "idea lightbulb suggestion"],
      ["🔔", "bell notify reminder"],
      ["📞", "phone call"],
      ["📧", "email mail"],
      ["💬", "chat message comment"],
      ["🔗", "link url"],
      ["🗑️", "trash delete bin remove"],
    ],
  },
  {
    name: "Money & property",
    emoji: [
      ["💰", "money bag cash"],
      ["💵", "dollar cash money"],
      ["💳", "card payment credit"],
      ["🏦", "bank"],
      ["🏠", "house home"],
      ["🏡", "house garden home"],
      ["🏘️", "houses homes neighbourhood park"],
      ["🚜", "tractor land"],
      ["🏗️", "construction build"],
      ["🧾", "receipt invoice tax"],
      ["⚖️", "legal law balance scales"],
      ["🔑", "key keys closing"],
      ["📐", "measure plan"],
      ["🗺️", "map land location"],
      ["📍", "pin location place"],
      ["🚚", "truck delivery transport"],
      ["⚡", "power electric fast"],
      ["🎯", "target goal"],
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.emoji);

/** The row above the picker, and the one-tap row on a message. */
export const QUICK_REACTIONS = ["👍", "🎉", "👀", "✅", "❤️", "😂"];

export function EmojiPicker({
  onPick,
  onClose,
  anchor,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** The trigger's rect, so the panel can be placed against it. */
  anchor: DOMRect;
}) {
  const [q, setQ] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    search.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    function onDown(e: MouseEvent) {
      if (!panel.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey, true);
    // A tick's delay: the click that OPENED this is still propagating, and
    // without it the panel closes in the same gesture that opened it.
    const t = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
      window.clearTimeout(t);
    };
  }, [onClose]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    return ALL.filter(([glyph, words]) => words.includes(needle) || glyph === needle).slice(0, 60);
  }, [q]);

  // Placed from the trigger's rect and clamped to the window, the same approach
  // as InfoTip and Dropdown — an absolutely-positioned panel is clipped to
  // nothing inside the message list's own scroll container.
  const WIDTH = 320;
  const HEIGHT = 360;
  const left = Math.min(Math.max(8, anchor.left - WIDTH + anchor.width), window.innerWidth - WIDTH - 8);
  const openUp = anchor.bottom + HEIGHT > window.innerHeight;

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Choose an emoji"
      className="sf-glass animate-pop-in fixed z-[70] rounded-2xl border shadow-pop"
      style={{
        left,
        width: WIDTH,
        ...(openUp ? { bottom: window.innerHeight - anchor.top + 8 } : { top: anchor.bottom + 8 }),
      }}
    >
      <div className="border-b border-ink-200 p-2">
        <input
          ref={search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search — try 'yes', 'money', 'happy'"
          aria-label="Search emoji"
          className="sf-input text-sm"
        />
      </div>

      <div className="max-h-72 overflow-y-auto p-2">
        {results ? (
          results.length ? (
            <Grid emoji={results} onPick={onPick} />
          ) : (
            <p className="px-1 py-6 text-center text-xs text-ink-500">
              Nothing matches “{q.trim()}”.
            </p>
          )
        ) : (
          GROUPS.map((group) => (
            <div key={group.name} className="mb-2 last:mb-0">
              <p className="px-1 pb-1 pt-1 text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-ink-500">
                {group.name}
              </p>
              <Grid emoji={group.emoji} onPick={onPick} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Grid({
  emoji,
  onPick,
}: {
  emoji: [string, string][];
  onPick: (emoji: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emoji.map(([glyph, words]) => (
        <button
          key={glyph}
          type="button"
          title={words.split(" ")[0]}
          onClick={() => onPick(glyph)}
          className="rounded-lg py-1.5 text-xl leading-none transition hover:bg-sf-100 focus:bg-sf-100 focus:outline-none"
        >
          {glyph}
        </button>
      ))}
    </div>
  );
}
