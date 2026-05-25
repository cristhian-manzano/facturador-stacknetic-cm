/**
 * PostCSS chain for the Vite build (SPEC-0040 §6.5 / PLAN-0040 §4 Phase 1).
 *
 * `tailwindcss` runs first to expand directives + scan templates.
 * `autoprefixer` follows so vendor prefixes are added after Tailwind has
 * emitted the final CSS. Order matters.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
