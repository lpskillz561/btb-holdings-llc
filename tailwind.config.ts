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
