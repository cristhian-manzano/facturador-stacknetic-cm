/**
 * XML sanitisation helpers for the factura builder (SPEC-0023 §6.2,
 * PROMPT-0023 §FR-5/FR-6, TASKS-0023 §1.2).
 *
 * The helpers are intentionally narrow: they don't pretend to "make any
 * string valid XML" — they enforce the precise rules SRI applies on
 * recepción. Everything that doesn't fit these rules is either rejected
 * at the schema boundary (Zod, in @facturador/contracts/sri) or stripped
 * here. We never silently corrupt the XML — the descripcion truncation
 * is the only lossy step and it is bounded (≤ 300 chars).
 *
 * Hard rules:
 *   - No I/O, no clock, no PRNG.
 *   - No `console.log` (linted out).
 *   - Pure: same input ⇒ same output, no shared state.
 */

/**
 * Escape the five XML special characters that may appear in text or
 * attribute values. The order matters — `&` MUST be escaped first or we
 * would double-escape the entities written below.
 *
 * We escape both single and double quotes so the helper is safe to use
 * for attribute values too (the builder relies on this for
 * `<detAdicional nombre="…" valor="…"/>` and
 * `<campoAdicional nombre="…">…</campoAdicional>`).
 *
 * Source: SPEC-0023 §FR-5.
 */
export const escapeXml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Strip C0 control characters (U+0000..U+0008, U+000B..U+000C, U+000E..U+001F)
 * and DEL (U+007F). We intentionally keep TAB (U+0009), LF (U+000A), and
 * CR (U+000D) in the input so the whitespace collapser below can turn
 * them into a single space — otherwise we'd glue adjacent words
 * together (`"a\nb"` ⇒ `"ab"` instead of `"a b"`).
 *
 * SRI's XML 1.0 parser rejects raw control chars; rather than emit an
 * XML that fails XSD on recepción, we drop them here.
 *
 * The regex is built via `new RegExp` with unicode escapes so the source
 * file stays free of literal C0 bytes (some editors / writers corrupt
 * those when round-tripping).
 */
// `no-control-regex` flags any control-char literal/escape inside a regex.
// We need exactly that — the whole point of this helper is to strip the
// C0 + DEL set. Disable narrowly for the construction below.
/* eslint-disable no-control-regex */
const CONTROL_CHARS_RE = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "gu");
/* eslint-enable no-control-regex */

/**
 * Whitespace collapser: any run of TAB / LF / CR / space → single space.
 * Applied to `descripcion` so multi-line product blurbs become a single
 * line per SRI's `descripcion` XSD pattern (`[^\n]*`).
 */
const WHITESPACE_RUN_RE = /[\t\n\r ]+/g;

/** SRI factura XSD `descripcion.maxLength`. */
export const DESCRIPCION_MAX_LENGTH = 300;

/**
 * Normalise a `descripcion` per SRI rules:
 *   1. Drop control chars (except whitespace).
 *   2. Collapse all whitespace runs (incl. line breaks) to a single space.
 *   3. Trim leading / trailing whitespace.
 *   4. Truncate to `DESCRIPCION_MAX_LENGTH` (300) chars.
 *
 * The function is order-sensitive — collapsing happens **before**
 * truncation so a leading run of whitespace doesn't consume the budget.
 *
 * Source: SPEC-0023 §FR-6 + TASKS-0023 §1.2.
 */
export const cleanDescripcion = (raw: string): string => {
  if (typeof raw !== "string") return "";
  const noControls = raw.replace(CONTROL_CHARS_RE, "");
  const collapsed = noControls.replace(WHITESPACE_RUN_RE, " ").trim();
  if (collapsed.length <= DESCRIPCION_MAX_LENGTH) return collapsed;
  return collapsed.slice(0, DESCRIPCION_MAX_LENGTH);
};

/**
 * Generic single-line text cleaner used for fields the XSD constrains
 * with the `[^\n]*` pattern but does NOT truncate (`razonSocial`,
 * `dirMatriz`, etc.). We strip control chars and replace any embedded
 * line break with a single space, but we don't truncate — Zod has
 * already enforced the per-field maxLength.
 *
 * The dedicated `cleanDescripcion` helper exists because descripcion is
 * the only XSD field with a "truncate silently" policy.
 */
export const cleanSingleLineText = (raw: string): string => {
  if (typeof raw !== "string") return "";
  return raw.replace(CONTROL_CHARS_RE, "").replace(WHITESPACE_RUN_RE, " ").trim();
};
