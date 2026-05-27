/**
 * Thin wrappers around tenant-related API calls.
 *
 * Kept here (not inside `lib/api.ts`) because the auth domain owns the
 * cache-reset semantics on tenant switch — `lib/api.ts` is the transport
 * primitive and must stay UI-agnostic.
 *
 * Source of truth:
 *   - SPEC-0011 §FR-3 — tenant switch rotates CSRF + the SPA invalidates
 *     all tenant-scoped queries.
 *   - PROMPT-0041 hard constraint — "on switch, call
 *     POST /api/v1/session/tenant and then queryClient.clear()".
 */
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { UlidSchema } from "@facturador/contracts/primitives";
import { RoleSchema } from "@facturador/contracts/tenants";

import { apiFetch } from "../lib/api.js";

/**
 * Response body from `POST /api/v1/session/tenant`.
 *
 * The server returns `{ companyId, role, csrfToken }`. We validate it as
 * with every other apiFetch consumer; the `csrfToken` field is informational
 * only (the cookie set by the same response is what authenticates future
 * requests).
 */
export const SwitchTenantResponseSchema = z.object({
  companyId: UlidSchema,
  role: RoleSchema,
  csrfToken: z.string().min(1),
});

export type SwitchTenantResponse = z.infer<typeof SwitchTenantResponseSchema>;

export interface SwitchTenantDeps {
  /** TanStack Query client — cleared atomically on success. */
  queryClient: Pick<QueryClient, "clear">;
  /**
   * Optional hook fired AFTER a successful switch and cache clear, BEFORE
   * the helper resolves. The login flow uses it to call `auth.refresh()`
   * so the topbar reflects the new active tenant.
   */
  onAfter?: () => Promise<void> | void;
}

/**
 * Switch the active tenant.
 *
 * Order of operations matters:
 *   1. POST `/api/v1/session/tenant` with `{ companyId }`. The server
 *      rotates the CSRF cookie + updates the session row.
 *   2. **Clear the TanStack Query cache.** Tenant-scoped data must never
 *      leak across tenants; clearing forces the next render to refetch
 *      with the new session cookie.
 *   3. Optionally run `onAfter` — typically `auth.refresh()` so the UI
 *      reflects the new active tenant.
 *
 * Errors from step 1 surface as `ApiError` and the cache is NOT cleared.
 */
export async function switchActiveTenant(
  companyId: string,
  deps: SwitchTenantDeps,
): Promise<SwitchTenantResponse> {
  const response = await apiFetch("/api/v1/session/tenant", {
    method: "POST",
    json: { companyId },
    schema: SwitchTenantResponseSchema,
  });
  deps.queryClient.clear();
  if (deps.onAfter !== undefined) {
    await deps.onAfter();
  }
  return response;
}
