import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
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
        gold: {
          200: "#f0e3c2",
          300: "#e3cf9b",
          400: "#d4b876",
          500: "#c8a45c",
          600: "#a9853f",
        },
        // Warm ivory paper for the light marketing surfaces.
        paper: {
          50: "#fbfaf7",
          100: "#f6f3ec",
          200: "#ece7da",
          300: "#ddd6c4",
        },

        // ------------------------------------------------------------------
        // Salesforce Lightning palette — the INTERNAL CRM only.
        //
        // The navy/gold above is the client-facing brand and stays on the
        // proposals, the contracts and the print pages: those go to a taxpayer
        // and their CPA, where "private bank" is worth more than "familiar
        // software". Everything a member of staff works in uses these instead,
        // because Lightning's density and colour are what a CRM is read fastest
        // in. Gold survives as an accent so the two are visibly the same
        // company.
        // ------------------------------------------------------------------
        sf: {
          50: "#eef4ff",
          100: "#d8e6fe",
          200: "#aacbff",
          300: "#78b0fd",
          400: "#1b96ff",
          500: "#0176d3", // Lightning Blue — the primary action colour
          600: "#0b5cab",
          700: "#014486",
          800: "#032d60",
          900: "#001639",
        },
        // Lightning's neutrals. `ink-100` is the page background that makes
        // white cards read as raised without needing a shadow.
        ink: {
          50: "#ffffff",
          100: "#f3f3f3",
          200: "#e5e5e5",
          300: "#c9c9c9",
          400: "#aeaeae",
          500: "#939393",
          600: "#747474",
          700: "#5c5c5c",
          800: "#444444",
          900: "#181818",
        },
        // The 50s are card-fill tints, added for the kanban: a whole card
        // washed in its status colour needs a wash light enough that ink-900
        // body text still reads on it. The 100s are badge fills and are too
        // saturated for that; a `/60` of one composites over the column's grey
        // and goes muddy rather than lighter.
        ok: { 50: "#eefaf1", 100: "#d5f2dd", 200: "#b0e4c1", 500: "#2e844a", 700: "#1b5b2c" },
        warn: { 50: "#fff8ef", 100: "#fef1e0", 200: "#fcd9b2", 500: "#fe9339", 700: "#a75200" },
        err: { 50: "#fff2ef", 100: "#feded8", 500: "#ea001e", 700: "#8e021b" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "ui-serif", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(10,20,48,0.04), 0 18px 40px -24px rgba(10,20,48,0.25)",
        lift: "0 24px 60px -28px rgba(10,20,48,0.45)",
        gold: "0 10px 30px -12px rgba(200,164,92,0.45)",
      },
      letterSpacing: {
        brand: "0.22em",
      },
      maxWidth: {
        content: "1200px",
      },
    },
  },
  plugins: [],
} satisfies Config;
