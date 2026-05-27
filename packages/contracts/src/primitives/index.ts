/**
 * Subpath: `@facturador/contracts/primitives`.
 *
 * Re-exports every primitive schema and its inferred type. New primitives
 * must register here so consumers continue to import via a single path
 * (PLAN-0005 §3 + TASKS-0005 §9.1).
 */
export { UlidSchema, type Ulid } from "./ulid.js";
export { EmailSchema, type Email } from "./email.js";
export {
  RucSchema,
  isValidRuc,
  isValidRucSociedad,
  isValidRucPersonaNatural,
  type Ruc,
} from "./ruc.js";
export { CedulaSchema, isValidCedulaChecksum, type Cedula } from "./cedula.js";
export { PasaporteSchema, type Pasaporte } from "./pasaporte.js";
export {
  ClaveAccesoSchema,
  computeClaveAccesoCheckDigit,
  formatClaveAccesoGroups,
  isValidClaveAcceso,
  type ClaveAcceso,
} from "./clave-acceso.js";
export { MoneySchema, MoneyQtySchema, type Money, type MoneyQty } from "./money.js";
export { IsoDateSchema, type IsoDate } from "./iso-date.js";
export { CurrencyCodeSchema, type CurrencyCode } from "./currency-code.js";
export { AmbienteSchema, type Ambiente } from "./ambiente.js";
export { TipoEmisionSchema, type TipoEmision } from "./tipo-emision.js";
export { TipoIdentificacionSchema, type TipoIdentificacion } from "./tipo-identificacion.js";
export {
  EstabSchema,
  PtoEmiSchema,
  SecuencialSchema,
  type Estab,
  type PtoEmi,
  type Secuencial,
} from "./establecimiento.js";
export { FechaEmisionSchema, type FechaEmision } from "./fecha-emision.js";
