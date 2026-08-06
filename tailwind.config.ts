import type { Config } from "tailwindcss";

/**
 * TWO PALETTES, AND ONLY ONE OF THEM MOVES.
 *
 * `navy` / `steel` / `gold` / `paper` below are LITERAL hex and must stay that
 * way. They are the client-facing brand: the proposals, the contract packets,
 * the /print routes and the 17-slide presentation deck are painted entirely out
 * of them, and those surfaces go to a taxpayer and their CPA. A colour that
 * shifts with the reader's OS appearance is exactly what a document must never
 * do — see "Two looks, on purpose" in CLAUDE.md.
 *
 * Everything below that — `sf`, `ink`, `ok`, `warn`, `err`, `card`, `accent` —
 * is the INTERNAL application, and every one of those resolves to a CSS
 * variable declared in globals.css. That indirection is what buys automatic
 * dark mode across 48 files without touching any of them: the class stays
 * `bg-card`, and the variable behind it changes under
 * `@media (prefers-color-scheme: dark)`.
 *
 * The split is verified rather than merely intended — no file under
 * components/present, and neither print page, references a single one of the
 * variable-backed tokens. Keep it that way. If a client-facing surface ever
 * needs one, it is the wrong token.
 *
 * The `<alpha-value>` placeholder is what keeps `bg-card/60` and
 * `text-ink-900/55` working; it requires the variables to be space-separated
 * RGB channel triplets ("255 255 255"), not hex and not `rgb(...)`.
 */

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const ramp = (prefix: string, steps: number[]) =>
  Object.fromEntries(steps.map((s) => [s, v(`${prefix}-${s}`)])) as Record<string, string>;

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        /* ================================================================== */
        /* CLIENT-FACING BRAND — literal, frozen, never theme-aware.          */
        /* ================================================================== */

        // Deep private-bank navy — anchors the brand, echoes the shield mark.
        navy: {
          950: "#060c1a",
          900: "#0a1430",
          800: "#0f1d40",
          700: "#162a55",
          600: "#1f386e",
          500: "#2a4988",
        },
        // Steel blue drawn from the shield's highlights.
        steel: {
          400: "#6c93ff",
          500: "#3d6dff",
          600: "#2451f5",
        },
        // Restrained champagne gold — used sparingly for trust + premium feel.
        // Charts.tsx separately hard-codes #b08a2c for marks on the navy deck
        // surface; that value was validated against that background and is not
        // one of these.
        gold: {
          200: "#f0e3c2",
          300: "#e3cf9b",
          400: "#d4b876",
          500: "#c8a45c",
          600: "#a9853f",
        },
        // Warm ivory paper for the light marketing and document surfaces.
        paper: {
          50: "#fbfaf7",
          100: "#f6f3ec",
          200: "#ece7da",
          300: "#ddd6c4",
        },

        /* ================================================================== */
        /* INTERNAL APPLICATION — variable-backed, follows the OS appearance.  */
        /*                                                                    */
        /* The name `sf` is now a misnomer kept on purpose: it is referenced   */
        /* ~180 times across 48 files, and the cost of a rename sweep is a lot */
        /* of diff noise for no behaviour change. It no longer means           */
        /* Salesforce; it is simply the primary action ramp, and it is now an   */
        /* indigo→violet that carries a gradient on the primary button.        */
        /* ================================================================== */

        sf: ramp("sf", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),

        // Neutrals. Note these INVERT in dark mode rather than being replaced:
        // ink-100 is always "the page", ink-900 is always "body text", so every
        // existing usage keeps meaning what it meant. Only the lightness flips.
        ink: ramp("ink", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),

        // The raised surface a card is filled with. This exists because the app
        // was full of literal `bg-white`, which cannot follow a theme — in dark
        // mode it is a white rectangle. Use `bg-card` on any internal surface;
        // `bg-white` now means "actually white" and belongs only on the deck.
        card: {
          DEFAULT: v("card"),
          // One step further forward: nested wells, hovered rows, the inside of
          // a kanban column. Lighter than `card` in light mode and lighter
          // again in dark, so "raised" reads the same way in both.
          2: v("card-2"),
        },

        // The internal echo of the brand gold. Distinct from `gold` because
        // `gold` is frozen for the documents: at #a9853f on a near-black card
        // this reads muddy, so the variable brightens in dark mode while the
        // documents' gold stays exactly where it is.
        accent: ramp("accent", [100, 300, 500, 600]),

        // Status ramps. The 50s are card-fill tints (a whole kanban card washed
        // in its status colour), the 100s are badge fills, the 500/700s are
        // marks and text. All four invert in dark mode.
        ok: ramp("ok", [50, 100, 200, 500, 700]),
        warn: ramp("warn", [50, 100, 200, 500, 700]),
        err: ramp("err", [50, 100, 500, 700]),
      },

      fontFamily: {
        // The macOS system face first, so the app renders in SF Pro on the
        // machines it is actually used on and falls back to Inter, then to
        // whatever the platform offers. `--font-sans` stays first so the
        // existing hook still overrides.
        sans: [
          "var(--font-sans)",
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Inter",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        // Untouched: this is what the documents are set in.
        serif: ["var(--font-serif)", "Georgia", "ui-serif", "serif"],
        // Tabular figures for money columns, so digits line up down a table.
        mono: ["ui-monospace", "SFMono-Regular", "SF Mono", "Menlo", "monospace"],
      },

      borderRadius: {
        // macOS's continuous-corner idiom reads as a larger radius than the web
        // default. These are the two the internal app uses.
        card: "14px",
        pill: "10px",
      },

      boxShadow: {
        // ---- Client-facing, unchanged. ----
        card: "0 1px 2px rgba(10,20,48,0.04), 0 18px 40px -24px rgba(10,20,48,0.25)",
        lift: "0 24px 60px -28px rgba(10,20,48,0.45)",
        gold: "0 10px 30px -12px rgba(200,164,92,0.45)",

        // ---- Internal. Layered rather than single, which is the whole
        // difference between "a box with a shadow" and something that looks
        // like it is sitting above the page: a tight contact shadow for the
        // edge, a wide diffuse one for the lift. Tuned as variables so dark
        // mode can drop the diffuse layer, where it only makes mud, and lean
        // on a hairline highlight instead. ----
        soft: "var(--shadow-soft)",
        raise: "var(--shadow-raise)",
        pop: "var(--shadow-pop)",
        // The focus/active glow on the primary action.
        glow: "var(--shadow-glow)",
      },

      backgroundImage: {
        // The primary action and the AI surfaces. Kept here rather than written
        // out at each call site so there is one place the brand gradient lives.
        "grad-brand": "linear-gradient(135deg, rgb(var(--sf-500)), rgb(var(--sf-400)))",
        "grad-brand-hover": "linear-gradient(135deg, rgb(var(--sf-600)), rgb(var(--sf-500)))",
        // Violet, and deliberately a different gradient from the primary one:
        // "the machine suggested this" should never be mistaken for "this is
        // the button you press to save".
        "grad-ai": "linear-gradient(135deg, rgb(var(--ai-from)), rgb(var(--ai-to)))",
      },

      letterSpacing: {
        brand: "0.22em",
      },
      maxWidth: {
        content: "1200px",
      },

      transitionTimingFunction: {
        // A short overshoot. macOS moves things with a spring, and a linear or
        // ease-out transition is the single biggest reason a web app feels like
        // a web app. Used on hover lifts and panel entrances, never on colour.
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },

      keyframes: {
        "pop-in": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(16px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "pop-in": "pop-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "slide-in-right": "slide-in-right 200ms ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
