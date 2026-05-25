/**
 * Tailwind config for `@facturador/web` (SPEC-0040 §6.5).
 *
 * Design tokens kept intentionally small:
 *   - `primary` palette — accent blue used for primary actions, links,
 *     focus rings. Mirrors the canonical "brand" scale (50..900).
 *   - `neutral` is left to Tailwind's default `slate` palette via class
 *     names; only the brand is extended.
 *   - `fontFamily.sans` falls back to the system stack to avoid loading
 *     remote fonts in v1 (CSP friendliness — SPEC-0040 §6 PROMPT §6.0).
 *
 * `content` globs cover every TSX/HTML file under `src/` and the root
 * `index.html`. Tree-shaking is fully on; dynamic class names must be
 * written out in full (no string concatenation) per PLAN-0040 §5.
 */
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
      },
    },
    extend: {
      colors: {
        primary: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af",
          800: "#1e3a8a",
          900: "#172554",
        },
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
