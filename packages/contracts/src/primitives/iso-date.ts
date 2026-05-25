/**
 * `IsoDateSchema` — calendar date in `YYYY-MM-DD` form.
 *
 * Wire format used by API/Web (TASKS-0005 §2.8 + SPEC-0032 §6.4). The SRI
 * XML uses `dd/mm/aaaa` — that translation happens server-side in the
 * invoice orchestrator, not at the contract boundary. Validation here is
 * the cheap regex check; full calendar validity (Feb-30 etc.) is the
 * concern of the orchestrator before claveAcceso build.
 */
import { z } from "zod";

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const IsoDateSchema = z
  .string()
  .regex(ISO_DATE_REGEX, "fecha debe tener formato YYYY-MM-DD")
  .brand<"IsoDate">();

export type IsoDate = z.infer<typeof IsoDateSchema>;
