/**
 * `nowInEcuador` — wall-clock "today" in `America/Guayaquil`.
 *
 * Why this exists (SPEC-0022 §6.3, REVIEW-0022 §13 #2):
 *
 *   - The `claveAcceso` carries `ddMMyyyy` of issuance — and the SRI
 *     authorises against the EMITTER's local calendar day. A server in
 *     UTC that emits at 23:30 EC on May 18 would otherwise stamp May 19
 *     into the clave (depending on which side of midnight UTC falls) and
 *     get rejected, or pass with the wrong day.
 *   - Orchestrators (SPEC-0033) and audit metadata also want a stable
 *     "today" tied to the EC business day, not the host clock.
 *
 * Design notes:
 *
 *   - Ecuador has NO DST (no Time-Zone change since 1992 — the country
 *     stays on UTC-5 year round). We still go through `Intl.DateTimeFormat`
 *     with `timeZone: "America/Guayaquil"` instead of hard-coding `-5h`
 *     because (a) it surface-tests that the runtime has tz data installed,
 *     and (b) if Ecuador ever re-adopts DST, the helper picks up the
 *     change without a redeploy.
 *   - `iso` returns the calendar date as `YYYY-MM-DD` — NOT a full
 *     ISO-8601 timestamp, because callers want the DATE part for keys
 *     (clave, audit grouping, secuencial files) and rolling their own
 *     formatter from `{year, month, day}` is repetitive.
 *   - The helper accepts an optional `now: Date` for testability — every
 *     test can pin a specific instant without monkey-patching `Date`.
 *
 * What this is NOT:
 *   - A general-purpose timezone library. If a caller needs hours/minutes
 *     in EC, build it explicitly (it's two extra `Intl` parts away).
 *   - A `Date` wrapper. We return plain primitives so the result is
 *     trivially serialisable and impossible to confuse with an instant.
 */

/**
 * Result of `nowInEcuador`. All fields are calendar values in
 * `America/Guayaquil` for the provided instant.
 */
export interface EcuadorWallClock {
  /** 4-digit year (e.g. 2026). */
  readonly year: number;
  /** 1-12 (NOT 0-11 — this is a HUMAN-readable month). */
  readonly month: number;
  /** 1-31. */
  readonly day: number;
  /** `YYYY-MM-DD` string. Zero-padded; trivially lexicographically sortable. */
  readonly iso: string;
}

/**
 * Cached formatter. `Intl.DateTimeFormat` construction is non-trivial
 * (parses options, loads tz data) so we build it once per process — this
 * helper is called once per `claveAcceso` build (high-traffic path).
 */
const FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Guayaquil",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Return the Ecuador calendar date for the given instant (defaults to
 * "now"). See `EcuadorWallClock`.
 *
 * Implementation: `Intl.DateTimeFormat#formatToParts` returns the
 * individual Y/M/D parts AS RENDERED in the requested tz. We grab those
 * and parse them back to integers — safer than relying on the format
 * string of `format()` which is locale-mutable.
 */
export function nowInEcuador(now: Date = new Date()): EcuadorWallClock {
  const parts = FORMATTER.formatToParts(now);

  let year = 0;
  let month = 0;
  let day = 0;
  for (const p of parts) {
    if (p.type === "year") year = Number(p.value);
    else if (p.type === "month") month = Number(p.value);
    else if (p.type === "day") day = Number(p.value);
  }

  // Defensive: every supported runtime exposes these three parts, but
  // `noUncheckedIndexedAccess` won't help here (we read by `type`, not
  // index). Throw on partial parse so test failures surface clearly.
  //
  // The branch is `c8 ignore`d because the only way to trigger it would
  // be on a Node binary without the full ICU dataset, which we don't
  // ship; the assertion still serves as documentation + a runtime
  // sanity net if the runtime drops the feature.
  /* c8 ignore start */
  if (year === 0 || month === 0 || day === 0) {
    throw new Error("nowInEcuador: Intl.DateTimeFormat did not produce year/month/day parts.");
  }
  /* c8 ignore stop */

  const iso = `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

  return { year, month, day, iso };
}
