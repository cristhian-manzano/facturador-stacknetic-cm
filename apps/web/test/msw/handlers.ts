/**
 * Canonical MSW handlers for `@facturador/web` tests (TASKS-0007 §4.2).
 *
 * Each handler validates its response payload via the contract schema's
 * `parse` (not `safeParse`).  Drift in either the handler or the schema
 * crashes the handler — Vitest surfaces that as a test failure, which is
 * exactly what PROMPT-0007 §4 demands.
 *
 * Endpoints stubbed:
 *   GET    /api/v1/me              → 200 MeResponse
 *   POST   /api/v1/auth/login      → 200 LoginResponse
 *   POST   /api/v1/auth/logout     → 204
 *
 * Synthetic data only:
 *   - Synthetic ULIDs encoded with `STUB` in their alphabet.
 *   - RUC prefixed `9999` (TASKS-0007 §5).
 *   - Email under `@facturador.test`.
 */
import { http, HttpResponse } from "msw";
import { LoginResponseSchema, MeResponseSchema } from "@facturador/contracts/auth";

const API_BASE = "http://api.test";

// ULIDs use Crockford base32 (excludes I, L, O, U).  Hand-rolled stubs
// must respect that alphabet — these values were minted via `ulid()`.
const STUB_USER = {
  id: "01KS5R6NXQVCTQBVD3RYJSGNB8",
  email: "alice@facturador.test",
  displayName: "Alice Stub",
};

const STUB_MEMBERSHIP = {
  companyId: "01KS5R6NXR0MY0X8SFHAH0GYHT",
  razonSocial: "STUB TENANT S.A.",
  role: "OWNER",
};

export const handlers = [
  http.get(`${API_BASE}/api/v1/me`, () => {
    const payload = MeResponseSchema.parse({
      user: STUB_USER,
      memberships: [STUB_MEMBERSHIP],
      activeCompanyId: STUB_MEMBERSHIP.companyId,
      // SPEC-0011: `/me` now carries the active role + matrix-derived
      // permissions. The stub mirrors the OWNER row for the active tenant.
      currentRole: STUB_MEMBERSHIP.role,
      permissions: [
        "tenant.read",
        "tenant.update",
        "tenant.manage_members",
        "customer.read",
        "customer.create",
        "customer.update",
        "customer.delete",
        "invoice.read",
        "invoice.create",
        "invoice.emit",
        "invoice.reissue",
        "certificate.manage",
        "establecimiento.manage",
      ],
    });
    return HttpResponse.json(payload);
  }),

  http.post(`${API_BASE}/api/v1/auth/login`, () => {
    const payload = LoginResponseSchema.parse({
      user: STUB_USER,
      memberships: [STUB_MEMBERSHIP],
      activeCompanyId: STUB_MEMBERSHIP.companyId,
      csrfToken: "csrf-stub-token-32-bytes-min-len",
    });
    return HttpResponse.json(payload);
  }),

  http.post(`${API_BASE}/api/v1/auth/logout`, () => {
    return new HttpResponse(null, { status: 204 });
  }),
];

export const API_BASE_URL = API_BASE;
