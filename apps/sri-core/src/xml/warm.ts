/**
 * Boot-time warmer for the XSD validator.
 *
 * `xmllint-wasm` initialises libxml2 lazily — the FIRST call to
 * `validateXML` pays a ~150 ms cold-start penalty as the WebAssembly
 * module is instantiated. Running one no-op validation at boot avoids
 * billing that cost to the first real `/v1/documents/emit` request.
 *
 * Source of truth: audit-punchlist Item 6 (REVIEW-0023 §12 #1).
 *
 * The warmer:
 *   - Runs `validateAgainstXsd("<factura/>")` — XSD will reject the
 *     payload but the WASM module will be instantiated as a side effect.
 *     We don't care about the result.
 *   - Emits a single `info` log line `xsd_validator.warmed` so ops can
 *     confirm the warm happened.
 *   - Swallows errors — a warm failure must never crash the boot.
 */
import type { Logger } from "@facturador/logger";

import { validateAgainstXsd } from "./validate.js";

/**
 * A tiny `<factura/>` skeleton. It's intentionally invalid against the
 * XSD — the only purpose is to cause `xmllint-wasm` to instantiate.
 */
const WARM_PAYLOAD =
  '<?xml version="1.0" encoding="UTF-8"?><factura id="comprobante" version="2.1.0"/>';

export async function warmXsdValidator(logger: Pick<Logger, "info" | "warn">): Promise<void> {
  try {
    // We discard the result — a side-effect call.
    await validateAgainstXsd(WARM_PAYLOAD);
    logger.info({ event: "xsd_validator.warmed" }, "xsd_validator.warmed");
  } catch (err) {
    logger.warn({ err, event: "xsd_validator.warm_failed" }, "xsd validator warm failed");
  }
}
