/**
 * Typed wrappers around `apiFetch` for the invoice endpoints used by the
 * create/edit UI (SPEC-0042 §6.2 + §6.4).
 *
 * Every wrapper:
 *   - Goes through `apiFetch` (CSRF + ProblemDetail + 401/403 events).
 *   - Validates the response with a Zod schema from `@facturador/contracts`.
 *   - Carries an optional `AbortSignal` so debounced callers can cancel
 *     in-flight requests (see `useDebouncedTotals`).
 *
 * NOT exported:
 *   - URL constants; the helpers are the only consumers.
 */
import { z } from "zod";

import { CreateCustomerSchema, type CreateCustomer } from "@facturador/contracts/customers";
import {
  CreateInvoiceSchema,
  EmitInvoiceResponseSchema,
  InvoiceDetailSchema,
  InvoiceListResponseSchema,
  InvoiceSchema,
  PreviewTotalsResponseSchema,
  type CreateInvoice,
  type EmitInvoiceResponse,
  type Invoice,
  type InvoiceDetail,
  type InvoiceListResponse,
  type PreviewTotalsResponse,
  type UpdateInvoice,
} from "@facturador/contracts/invoices";

import { apiFetch } from "../lib/api.js";

// ---------------------------------------------------------------------------
// Customer search
// ---------------------------------------------------------------------------

/**
 * Public list shape — matches `apps/api/src/customers/handlers.ts`
 * `toListResponse`. NO PII fields here (the API endpoint deliberately
 * omits them per SPEC-0031 §10). The combobox only needs the display
 * fields anyway.
 */
export const CustomerListItemSchema = z.object({
  id: z.string().min(1),
  tipoIdentificacion: z.enum(["04", "05", "06", "07", "08"]),
  identificacion: z.string().min(1),
  razonSocial: z.string().min(1),
  nombreComercial: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomerListItem = z.infer<typeof CustomerListItemSchema>;

export const CustomerListResponseSchema = z.object({
  items: z.array(CustomerListItemSchema),
  nextCursor: z.string().nullable(),
});
export type CustomerListResponse = z.infer<typeof CustomerListResponseSchema>;

/**
 * Search customers by `q` (matches razonSocial prefix or identificacion
 * exactly per `apps/api/src/customers/handlers.ts`).
 */
export async function searchCustomers(
  q: string,
  options?: { signal?: AbortSignal; limit?: number },
): Promise<CustomerListResponse> {
  const params = new URLSearchParams({ q });
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  const url = `/api/v1/customers?${params.toString()}`;
  const init: { schema: typeof CustomerListResponseSchema; signal?: AbortSignal } = {
    schema: CustomerListResponseSchema,
  };
  if (options?.signal !== undefined) init.signal = options.signal;
  return apiFetch(url, init);
}

/**
 * Create a customer. Body validated client-side by `CreateCustomerSchema`
 * (Zod). The API re-validates server-side; this is defense in depth.
 */
export const CustomerCreatedResponseSchema = CustomerListItemSchema.extend({
  email: z.string().nullable().optional(),
  telefono: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
});
export type CustomerCreatedResponse = z.infer<typeof CustomerCreatedResponseSchema>;

export async function createCustomer(body: CreateCustomer): Promise<CustomerCreatedResponse> {
  // Re-parse client-side — gives a friendly error before we hit the wire.
  const parsed = CreateCustomerSchema.parse(body);
  return apiFetch("/api/v1/customers", {
    method: "POST",
    json: parsed,
    schema: CustomerCreatedResponseSchema,
  });
}

// ---------------------------------------------------------------------------
// Emission points (flattened across establecimientos)
// ---------------------------------------------------------------------------

export const EstablecimientoListItemSchema = z.object({
  id: z.string().min(1),
  codigo: z.string().min(1),
  direccion: z.string().min(1),
  isMatriz: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EstablecimientoListItem = z.infer<typeof EstablecimientoListItemSchema>;

export const EstablecimientoListResponseSchema = z.array(EstablecimientoListItemSchema);

export const EmissionPointListItemSchema = z.object({
  id: z.string().min(1),
  establecimientoId: z.string().min(1),
  codigo: z.string().min(1),
  descripcion: z.string(),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EmissionPointListItem = z.infer<typeof EmissionPointListItemSchema>;

export const EmissionPointListResponseSchema = z.array(EmissionPointListItemSchema);

/**
 * Flat row shown in the dropdown.
 */
export interface EmissionPointOption {
  readonly id: string;
  readonly label: string;
  readonly establecimientoCodigo: string;
  readonly puntoEmisionCodigo: string;
  readonly isDefault: boolean;
}

/**
 * Fetch all establecimientos for the active tenant, then fetch emission
 * points for each. Returns a flat list ready for the dropdown.
 *
 * Done sequentially-then-parallel: one GET for establecimientos, then
 * `Promise.all` over the emission-point GETs. The N here is small (a
 * typical SMB has 1–3 establecimientos and 1–5 puntos each).
 */
export async function listEmissionPointOptions(
  signal?: AbortSignal,
): Promise<EmissionPointOption[]> {
  const establecimientosInit: {
    schema: typeof EstablecimientoListResponseSchema;
    signal?: AbortSignal;
  } = { schema: EstablecimientoListResponseSchema };
  if (signal !== undefined) establecimientosInit.signal = signal;
  const establecimientos = await apiFetch("/api/v1/establecimientos", establecimientosInit);
  const results = await Promise.all(
    establecimientos.map(async (estab) => {
      const ptosInit: {
        schema: typeof EmissionPointListResponseSchema;
        signal?: AbortSignal;
      } = { schema: EmissionPointListResponseSchema };
      if (signal !== undefined) ptosInit.signal = signal;
      const ptos = await apiFetch(
        `/api/v1/establecimientos/${encodeURIComponent(estab.id)}/emission-points`,
        ptosInit,
      );
      return ptos.map<EmissionPointOption>((p) => ({
        id: p.id,
        label: `${estab.codigo}-${p.codigo} ${p.descripcion}`.trim(),
        establecimientoCodigo: estab.codigo,
        puntoEmisionCodigo: p.codigo,
        isDefault: p.isDefault,
      }));
    }),
  );
  return results.flat();
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/**
 * Create a draft invoice (`POST /api/v1/invoices`). Server returns the
 * full `Invoice` row.
 */
export async function createInvoiceDraft(
  body: CreateInvoice,
  signal?: AbortSignal,
): Promise<Invoice> {
  // Re-parse client-side to give friendly errors before the wire call.
  CreateInvoiceSchema.parse(body);
  const init: {
    method: "POST";
    json: CreateInvoice;
    schema: typeof InvoiceSchema;
    signal?: AbortSignal;
  } = {
    method: "POST",
    json: body,
    schema: InvoiceSchema,
  };
  if (signal !== undefined) init.signal = signal;
  return apiFetch("/api/v1/invoices", init);
}

/**
 * Update an existing draft invoice (`PATCH /api/v1/invoices/:id`). The
 * server rejects PATCHing non-BORRADOR invoices with 422 `locked`.
 */
export async function updateInvoiceDraft(
  id: string,
  body: UpdateInvoice,
  signal?: AbortSignal,
): Promise<Invoice> {
  const init: {
    method: "PATCH";
    json: UpdateInvoice;
    schema: typeof InvoiceSchema;
    signal?: AbortSignal;
  } = {
    method: "PATCH",
    json: body,
    schema: InvoiceSchema,
  };
  if (signal !== undefined) init.signal = signal;
  return apiFetch(`/api/v1/invoices/${encodeURIComponent(id)}`, init);
}

/**
 * Get an invoice with its joined customer + SRI document + events.
 */
export async function getInvoiceDetail(id: string, signal?: AbortSignal): Promise<InvoiceDetail> {
  const init: { schema: typeof InvoiceDetailSchema; signal?: AbortSignal } = {
    schema: InvoiceDetailSchema,
  };
  if (signal !== undefined) init.signal = signal;
  return apiFetch(`/api/v1/invoices/${encodeURIComponent(id)}`, init);
}

/**
 * Preview totals. Server-computed; the UI NEVER computes its own totals.
 * `id` is required (`/preview-totals` is mounted under `/:id/preview-totals`
 * — wait, see note: actually the API mounts a literal `POST /api/v1/invoices/
 * preview-totals` per SPEC-0033 §6.2). Both forms are checked here for
 * forwards-compatibility; the current API uses the literal endpoint, so we
 * call it directly.
 *
 * To be safe with REVIEW-0033's endpoint table (`POST /api/v1/invoices/
 * preview-totals` BEFORE `/:id`), we use the literal endpoint regardless
 * of whether the draft exists yet.
 */
export async function previewInvoiceTotals(
  body: CreateInvoice,
  signal?: AbortSignal,
): Promise<PreviewTotalsResponse> {
  const init: {
    method: "POST";
    json: CreateInvoice;
    schema: typeof PreviewTotalsResponseSchema;
    signal?: AbortSignal;
  } = {
    method: "POST",
    json: body,
    schema: PreviewTotalsResponseSchema,
  };
  if (signal !== undefined) init.signal = signal;
  return apiFetch("/api/v1/invoices/preview-totals", init);
}

/**
 * Emit a draft. Returns the orchestrator response (estado / claveAcceso /
 * mensajes…). Errors surface as typed `ApiError`s; callers translate them
 * to EmitModal states.
 */
export async function emitInvoice(id: string, signal?: AbortSignal): Promise<EmitInvoiceResponse> {
  const init: { method: "POST"; schema: typeof EmitInvoiceResponseSchema; signal?: AbortSignal } = {
    method: "POST",
    schema: EmitInvoiceResponseSchema,
  };
  if (signal !== undefined) init.signal = signal;
  return apiFetch(`/api/v1/invoices/${encodeURIComponent(id)}/emit`, init);
}

// ---------------------------------------------------------------------------
// List + per-row operations (SPEC-0043)
// ---------------------------------------------------------------------------

/**
 * Filter / pagination shape consumed by `<FiltersBar />` and persisted in
 * the URL search params (SPEC-0043 §FR-1).
 *
 * Each field is OPTIONAL — when omitted we drop it from the URL entirely
 * so the canonical "no filters" state is the bare path `/invoices`.
 */
export interface InvoiceListFilters {
  /** Multi-select estado. Server accepts repeated `?estado=` params. */
  readonly estado?: readonly ("BORRADOR" | "EMITIDO" | "ANULADO")[];
  /** ISO date `YYYY-MM-DD`. */
  readonly from?: string;
  /** ISO date `YYYY-MM-DD`. */
  readonly to?: string;
  /** Free-text search (server matches razonSocial / claveAcceso). */
  readonly q?: string;
  /** Opaque pagination cursor returned by the prior page. */
  readonly cursor?: string;
  /** Page size (defaults to server's 20). */
  readonly limit?: number;
}

/**
 * Build a `URLSearchParams` for the given filter set. Stable order so
 * tests can assert exact URL strings. Empty / undefined / empty-array
 * fields are dropped.
 */
export function buildInvoiceListSearchParams(filters: InvoiceListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.estado !== undefined && filters.estado.length > 0) {
    // Canonical comma-form (REVIEW-0044 §5). The API parser also accepts
    // repeated `?estado=` for backwards-compat; we always emit the new
    // shape so URLs are stable across the SPA.
    params.set("estado", [...filters.estado].join(","));
  }
  if (filters.from !== undefined && filters.from !== "") {
    params.set("from", filters.from);
  }
  if (filters.to !== undefined && filters.to !== "") {
    params.set("to", filters.to);
  }
  if (filters.q !== undefined && filters.q !== "") {
    params.set("q", filters.q);
  }
  if (filters.cursor !== undefined && filters.cursor !== "") {
    params.set("cursor", filters.cursor);
  }
  if (filters.limit !== undefined) {
    params.set("limit", String(filters.limit));
  }
  return params;
}

/**
 * `GET /api/v1/invoices?…` — cursor-paginated list.
 *
 * Validates the response against `InvoiceListResponseSchema`. Throws
 * `ApiError` on any non-2xx (including 401/403, which also dispatch the
 * `auth:401|403` window events handled by `AuthProvider`).
 */
export async function listInvoices(
  filters: InvoiceListFilters = {},
  signal?: AbortSignal,
): Promise<InvoiceListResponse> {
  const params = buildInvoiceListSearchParams(filters);
  const qs = params.toString();
  const url = qs === "" ? "/api/v1/invoices" : `/api/v1/invoices?${qs}`;
  const init: { schema: typeof InvoiceListResponseSchema; signal?: AbortSignal } = {
    schema: InvoiceListResponseSchema,
  };
  if (signal !== undefined) init.signal = signal;
  return apiFetch(url, init);
}

/**
 * `POST /api/v1/invoices/:id/refresh` — sync sriEstado with SRI.
 *
 * Returns the (validated) updated detail so the caller can mutate
 * TanStack Query's cache directly. Mutating verb → CSRF carried by
 * `apiFetch` automatically.
 */
export async function refreshInvoice(id: string, signal?: AbortSignal): Promise<InvoiceDetail> {
  const init: { method: "POST"; schema: typeof InvoiceDetailSchema; signal?: AbortSignal } = {
    method: "POST",
    schema: InvoiceDetailSchema,
  };
  if (signal !== undefined) init.signal = signal;
  return apiFetch(`/api/v1/invoices/${encodeURIComponent(id)}/refresh`, init);
}

/**
 * `POST /api/v1/invoices/:id/reissue` — clone as a new BORRADOR.
 *
 * Server returns `{ newInvoiceId }` per `apps/api/src/invoices/orchestrator.ts`.
 * We narrowly schema-validate so the caller can navigate safely.
 */
export const ReissueInvoiceResponseSchema = z.object({
  newInvoiceId: z.string().min(1),
});
export type ReissueInvoiceResponse = z.infer<typeof ReissueInvoiceResponseSchema>;

export async function reissueInvoice(
  id: string,
  signal?: AbortSignal,
): Promise<ReissueInvoiceResponse> {
  const init: {
    method: "POST";
    schema: typeof ReissueInvoiceResponseSchema;
    signal?: AbortSignal;
  } = {
    method: "POST",
    schema: ReissueInvoiceResponseSchema,
  };
  if (signal !== undefined) init.signal = signal;
  return apiFetch(`/api/v1/invoices/${encodeURIComponent(id)}/reissue`, init);
}

/**
 * `DELETE /api/v1/invoices/:id` — delete a BORRADOR.
 *
 * Server returns 204 No Content; we narrow to `void`.
 */
export async function deleteInvoice(id: string, signal?: AbortSignal): Promise<void> {
  const init: { method: "DELETE"; signal?: AbortSignal } = { method: "DELETE" };
  if (signal !== undefined) init.signal = signal;
  await apiFetch(`/api/v1/invoices/${encodeURIComponent(id)}`, init);
}
