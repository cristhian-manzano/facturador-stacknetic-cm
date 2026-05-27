# @facturador/api

Production HTTP service for facturador-stacknetic-cm. Hosts the auth surface,
tenant + RBAC routes, customer/invoice/establecimiento CRUD, and the
orchestrator that talks to `apps/sri-core` for SRI emission, polling, and
refresh. Audit and request-id middleware are wired at the top of the chain
so every line in the access log can be correlated.

## Production-readiness environment

The Zod-validated env schema lives in `src/env.ts`. The keys below are the
ones that materially change behaviour in production — leave them unset to
get the dev/test defaults.

### `TRUST_PROXY_HOPS`

Express `trust proxy` setting. The rate limiter inspects this to resolve
`req.ip`; a misconfigured value lets a client spoof `X-Forwarded-For` and
evade per-IP throttling.

| Deployment                         | Value         |
| ---------------------------------- | ------------- |
| Single nginx / ALB in front        | `1`           |
| Two proxies (CDN → load balancer)  | `2`           |
| Local development / direct connect | `loopback` (default) |
| Strict trust (any proxy)           | `true`        |

Accepts integers (hop count), the string `"true"`, and Express preset
strings (`"loopback"`, `"linklocal"`, `"uniquelocal"`).

### `RBAC_ADMIN_CAN_UPDATE_TENANT`

Default `false`. Per SPEC-0011 §FR-5 the `tenant.update` permission is
OWNER-only — ADMIN gets view access. Set to `true` to restore the legacy
behaviour where ADMIN can rename a tenant; the matrix test is exhaustive
and locks in whichever branch is configured at boot.

### `SECUENCIAL_RESERVE_MAX_RETRIES`

Default `3`. Retry budget for the serializable transaction that reserves
the next factura secuencial under contention. Setting this higher trades
latency for throughput on bursty workloads; lower trips
`secuencial.reserve_exhausted` faster so a misbehaving caller is
rejected sooner.

### Audit chain — `payloadHash`

Every audit row carries `payloadHash = SHA-256(prev.payloadHash ||
canonicalJson(payload))`. The helper that computes the value lives in
`@facturador/utils/audit`; the column is nullable so legacy rows from
before the migration are still valid. A nightly chain-walker (out of
scope for v1) can verify continuity by re-computing each row's hash
from the predecessor.

### Background expired-session sweep

A daily node-cron job (`src/auth/session-sweep.ts`, scheduled in
`src/server.ts`) deletes session rows whose `expiresAt` was more than
seven days ago. Skipped in `NODE_ENV=test`; runs at 03:15 UTC by default.

## Certificates proxy

`POST /api/v1/certificates`, `GET /api/v1/certificates`,
`POST /api/v1/certificates/:id/activate`, `DELETE /api/v1/certificates/:id`
are thin pass-throughs to `apps/sri-core`. All routes require
`certificate.manage` (OWNER or ADMIN) and CSRF on the mutating verbs.
The api mints a fresh service-JWT per call (60 s TTL); the upstream
response and status code are streamed through unchanged.
