/**
 * IVA rate catalog + selector — RE-EXPORTED from `@facturador/contracts/sri`.
 *
 * The implementation moved to `packages/contracts/src/sri/iva.ts` so the
 * api and web share a SINGLE source of truth (REVIEW-0042 §2). This file
 * is preserved as a thin barrel so existing callers and the test fixture
 * keep working without churning imports.
 *
 * If you're adding a new IVA-related helper, add it in
 * `packages/contracts/src/sri/iva.ts` and re-export here.
 */
export {
  IVA_CODIGO,
  ICE_CODIGO,
  IRBPNR_CODIGO,
  IVA_15_EFFECTIVE_FROM,
  IVA_TABLE,
  pickIvaCode,
  isIvaCodeValidFor,
  getIvaRow,
  type IvaCatalogRow,
  type PickIvaCodeResult,
} from "@facturador/contracts/sri";
