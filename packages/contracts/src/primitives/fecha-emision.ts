/**
 * `FechaEmisionSchema` — `dd/mm/aaaa` date used inside SRI XML.
 *
 * SPEC-0005 §6.3 and the ficha técnica §6/§8 require the literal slash form.
 * The API/Web stack carries dates as `IsoDateSchema` (`YYYY-MM-DD`) and only
 * formats to this shape when handing off to the SRI Core orchestrator.
 *
 * Year range 2000–2099 is a defensive sanity check; SRI does not officially
 * cap, but documents from outside this range are almost certainly typos in
 * 2026.
 */
import { z } from "zod";

const FECHA_REGEX = /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(20\d{2})$/;

export const FechaEmisionSchema = z
  .string()
  .regex(FECHA_REGEX, "fechaEmision debe tener formato dd/mm/aaaa (2000–2099)")
  .brand<"FechaEmision">();

export type FechaEmision = z.infer<typeof FechaEmisionSchema>;
