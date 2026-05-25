---
id: SPEC-0020
title: SRI Core service bootstrap
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0001, SPEC-0002, SPEC-0003, SPEC-0004, SPEC-0005, SPEC-0006, SPEC-0007]
blocks: [SPEC-0021, SPEC-0023, SPEC-0024, SPEC-0025, SPEC-0026, SPEC-0033]
---

# SPEC-0020 — SRI Core service bootstrap

## 1. Purpose

Stand up the **SRI Core** Express service: a sandbox that holds tenant certificates and talks to the SRI web services. **No business logic** lives here. It exposes a small, well-typed surface to `apps/api` and rejects everything else.

## 2. Scope

### 2.1 In scope

- Express 5 app bootstrap mirroring `apps/api` conventions: env validation, logger, error handler, health, request ID.
- Service-to-service authentication between `apps/api` and `apps/sri-core`: signed JWTs (HS256) per request, short-lived (60 s), with `aud=sri-core`, `iss=api`, `sub=tenant:<companyId>`.
- HTTP API contract: `POST /v1/documents/emit`, `GET /v1/documents/:claveAcceso/status`, `POST /v1/documents/:claveAcceso/resend`.
- Error normalization: any SRI/SOAP/parse failure is mapped into the spec-0006 error taxonomy before crossing the wire.
- Health endpoints `/healthz`, `/readyz`.

### 2.2 Out of scope

- Certificate storage internals — see [SPEC-0021](./0021-certificate-management.md).
- XML construction / signing — see [SPEC-0023](./0023-xml-builder-factura.md) / [SPEC-0024](./0024-xades-bes-signer.md).
- SOAP clients — see [SPEC-0025](./0025-sri-soap-clients.md).
- State machine + polling — see [SPEC-0026](./0026-document-lifecycle-and-jobs.md).

## 3. Context & references

- [`ai/context/security.md`](../context/security.md) — SRI Core is the only zone allowed to hold certificates.
- [`ai/context/sri-domain.md`](../context/sri-domain.md) — lifecycle, signing, validation chain.
- [SPEC-0006](./0006-error-model-and-logging.md) — error model + logger.
- [SPEC-0005](./0005-shared-contracts.md) — `EmitDocumentRequest/ResponseSchema`.

## 4. Functional requirements

- **FR-1.** `POST /v1/documents/emit` accepts an `EmitDocumentRequest` ([SPEC-0005](./0005-shared-contracts.md) §6.7) and returns `EmitDocumentResponse`. Internally orchestrates: load cert → build XML → sign → send to recepción → optionally consult autorización (sync best-effort, async fallback) → persist.
- **FR-2.** `GET /v1/documents/:claveAcceso/status` returns the latest known state and the chronological list of SRI events for that document — scoped to the authenticated tenant (JWT `sub`).
- **FR-3.** `POST /v1/documents/:claveAcceso/resend` triggers a re-recepción (only allowed from states `DEVUELTA`, `ERROR_RED`, `EN_PROCESO`; rejected from `AUTORIZADO`/`NO_AUTORIZADO`).
- **FR-4.** Every endpoint requires a valid service JWT in `Authorization: Bearer <jwt>`. Token verified with `SRI_CORE_SERVICE_TOKEN_SECRET`. Reject expired/invalid → `401 sri.service_token_invalid`.
- **FR-5.** SRI Core never returns raw SOAP/XML errors. All upstream errors normalized to the codes from [SPEC-0006](./0006-error-model-and-logging.md) §6.7. Useful detail is preserved in a `messages[]` array; the original XML body is **logged at debug** but **never returned**.
- **FR-6.** SRI Core has its own Postgres connection (same DB, separate schema **or** shared schema — see §6.4). Owns tables: `Certificate`, `SriDocument`, `SriEvent`.
- **FR-7.** Health: `/healthz` (always 200 if process up), `/readyz` (DB ping + cert vault decrypt smoke test + outbound TLS reach to test SRI endpoint with 2 s timeout).

## 5. Non-functional requirements

- **NFR-1.** `POST /v1/documents/emit` P95 ≤ 3 s end-to-end when SRI is responsive (signing ~150 ms, SOAP ~1.5 s, autorización polling deferred).
- **NFR-2.** Refuses requests larger than 1 MB (Express body limit). XSDs allow large payloads; enforce sensible cap.
- **NFR-3.** TLS 1.2+ outbound; pinned in the HTTPS agent.
- **NFR-4.** No request body containing certificates or signed XML enters the logs (already covered by redactions, but reasserted here).

## 6. Technical design

### 6.1 Layout

```
apps/sri-core/
├── prisma/
│   └── schema.prisma             # see §6.4
├── src/
│   ├── main.ts                   # boot
│   ├── app.ts                    # express factory
│   ├── env.ts                    # Zod-validated env
│   ├── logger.ts
│   ├── middleware/
│   │   ├── request-logger.ts
│   │   ├── service-token.ts      # JWT verifier
│   │   └── error-handler.ts
│   ├── documents/
│   │   ├── routes.ts             # /v1/documents/*
│   │   ├── handlers/
│   │   │   ├── emit.ts
│   │   │   ├── status.ts
│   │   │   └── resend.ts
│   │   └── services/             # XML, sign, soap, state — populated by later specs
│   ├── certificates/             # SPEC-0021
│   ├── health/
│   │   └── routes.ts
│   └── db/
│       └── client.ts
└── test/
```

### 6.2 Env additions (already in `.env.example` from SPEC-0003)

`SRI_CORE_PORT`, `SRI_CORE_PUBLIC_URL`, `SRI_CORE_SERVICE_TOKEN_SECRET`, `SRI_CERT_MASTER_KEY_HEX`, `SRI_RECEPCION_URL_PRUEBAS`, `SRI_AUTORIZACION_URL_PRUEBAS`, `SRI_RECEPCION_URL_PRODUCCION`, `SRI_AUTORIZACION_URL_PRODUCCION`, `SRI_HTTP_TIMEOUT_MS`.

### 6.3 Service-to-service JWT (HS256)

API mints, SRI Core verifies. Claims:

```jsonc
{
  "iss": "api",
  "aud": "sri-core",
  "sub": "tenant:<companyId>",
  "iat": <epoch>,
  "exp": <epoch + 60>,
  "jti": "<ulid>"   // not currently checked against replay, but logged
}
```

Verifier:

```ts
// apps/sri-core/src/middleware/service-token.ts
import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../env.js";
import { AppError } from "../errors/app-error.js";

export const requireServiceToken: RequestHandler = (req, _res, next) => {
  const h = req.header("authorization");
  if (!h?.startsWith("Bearer "))
    throw new AppError("sri.service_token_invalid", 401, "Missing service token");
  try {
    const payload = jwt.verify(h.slice(7), env.SRI_CORE_SERVICE_TOKEN_SECRET, {
      algorithms: ["HS256"],
      audience: "sri-core",
      issuer: "api",
    }) as { sub: string };
    if (!payload.sub?.startsWith("tenant:")) throw new Error("bad sub");
    (req as any).companyId = payload.sub.slice("tenant:".length);
    next();
  } catch {
    throw new AppError("sri.service_token_invalid", 401, "Invalid service token");
  }
};
```

API mints a fresh JWT per outbound call:

```ts
// apps/api/src/sri/sri-core-client.ts (sketch — full impl in SPEC-0033)
import jwt from "jsonwebtoken";
import { env } from "../env.js";

const mintToken = (companyId: string) =>
  jwt.sign({ jti: ulid() }, env.SRI_CORE_SERVICE_TOKEN_SECRET, {
    algorithm: "HS256",
    expiresIn: 60,
    audience: "sri-core",
    issuer: "api",
    subject: `tenant:${companyId}`,
  });
```

### 6.4 Data ownership

SRI Core owns three tables:

```prisma
model Certificate {
  id             String   @id // ULID
  companyId      String
  alias          String
  serialNumber   String
  subjectDn      String
  issuerDn       String
  validFrom      DateTime
  validTo        DateTime
  status         CertificateStatus // ACTIVE | INACTIVE | REVOKED | EXPIRED
  encryptedP12   Bytes              // AES-256-GCM ciphertext (see SPEC-0021)
  encryptedPass  Bytes              // AES-256-GCM ciphertext for passphrase
  kmsKeyVersion  String             // version of master key used
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  deletedAt      DateTime?

  @@index([companyId, status])
  @@unique([companyId, serialNumber])
  @@map("certificates")
}

enum CertificateStatus { ACTIVE INACTIVE REVOKED EXPIRED }

model SriDocument {
  id                  String   @id
  companyId           String
  claveAcceso         String   @unique
  ambiente            String
  codDoc              String   // '01' factura, etc.
  estab               String
  ptoEmi              String
  secuencial          String
  fechaEmision        DateTime
  estado              String   // see SPEC-0026 state machine
  numeroAutorizacion  String?
  fechaAutorizacion   DateTime?
  signedXmlBlobId     String?  // pointer to blob store (filesystem in dev)
  authorizedXmlBlobId String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  events              SriEvent[]

  @@index([companyId, estado, createdAt])
  @@map("sri_documents")
}

model SriEvent {
  id              String   @id
  documentId      String
  etapa           String   // RECEPCION | AUTORIZACION
  estado          String
  mensajes        Json     // array of { identificador, mensaje, informacionAdicional, tipo }
  durationMs      Int
  createdAt       DateTime @default(now())

  document        SriDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  @@index([documentId, createdAt])
  @@map("sri_events")
}
```

**Schema decision:** SRI Core uses the **same database** as API but a separate Prisma schema **logical** namespace via Prisma multi-schema? No — keep it simpler: one Postgres database, one schema, one Prisma schema file shared between API and SRI Core via a `packages/db-schema/` package? Also overkill.

Final decision: **two separate Prisma clients in two separate apps, both pointed at the same database, each owning a disjoint set of tables**. The shared `Company.id` is a string ULID and acts as the foreign-key target — but the FK is **not** enforced across Prisma schemas; logical referential integrity is the responsibility of API/SRI Core code. This keeps both services independently deployable.

To avoid drift, each app's `prisma/schema.prisma` includes a comment listing the foreign tables it touches by ID only.

### 6.5 App factory

```ts
// apps/sri-core/src/app.ts
import express from "express";
import helmet from "helmet";
import { requestLogger } from "./middleware/request-logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requireServiceToken } from "./middleware/service-token.js";
import documentsRouter from "./documents/routes.js";
import healthRouter from "./health/routes.js";

export const createApp = () => {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger);
  app.use("/healthz", healthRouter);
  app.use("/v1/documents", requireServiceToken, documentsRouter);
  app.use(errorHandler);
  return app;
};
```

### 6.6 Handler skeletons (real logic in later specs)

```ts
// apps/sri-core/src/documents/handlers/emit.ts
import type { RequestHandler } from "express";
import { EmitDocumentRequestSchema } from "@facturador/contracts/sri";

export const emit: RequestHandler = async (req, res) => {
  const body = EmitDocumentRequestSchema.parse(req.body);
  const companyId = (req as any).companyId;
  if (body.companyId !== companyId) {
    // Token's tenant must match body's tenant.
    throw new AppError("tenant.forbidden", 403, "Tenant mismatch in request");
  }
  // TODO(SPEC-0023-0026): orchestrate build → sign → send → persist
  res.json({
    /* EmitDocumentResponse */
  });
};
```

### 6.7 Error normalization

A central function maps SOAP/SRI errors to the taxonomy:

```ts
// apps/sri-core/src/documents/services/error-mapper.ts
import { AppError } from "../../errors/app-error.js";

export const mapSriError = (input: {
  etapa: "RECEPCION" | "AUTORIZACION";
  estado: string;
  mensajes?: Mensaje[];
}): AppError => {
  switch (input.estado) {
    case "DEVUELTA":
      return new AppError(
        "sri.devuelta",
        422,
        "SRI rejected at recepción",
        undefined,
        undefined,
        input.mensajes,
      );
    case "NO AUTORIZADO":
      return new AppError(
        "sri.no_autorizado",
        422,
        "SRI did not authorize the document",
        undefined,
        undefined,
        input.mensajes,
      );
    case "EN PROCESO":
      return new AppError("sri.en_proceso", 202, "SRI still processing");
    default:
      return new AppError("sri.unknown_estado", 502, `Unknown SRI estado: ${input.estado}`);
  }
};
```

(`AppError` constructor variant accepts mensajes via the `metadata` channel; align with the SRI Core's local AppError.)

## 7. Implementation guide

### 7.1 Steps

1. Scaffold the layout in §6.1.
2. Wire env, logger, middlewares, health routes.
3. Implement service-token middleware + minimal handler stubs that respond `501 Not Implemented` until [SPEC-0023](./0023-xml-builder-factura.md)+ land.
4. Add the Prisma schema in §6.4 and run `prisma migrate dev --name sri_core_init` in `apps/sri-core/`.
5. Add Vitest setup with an in-process fake JWT signer for tests.

### 7.2 Dependencies

| Package                           | Version                                     | Purpose           |
| --------------------------------- | ------------------------------------------- | ----------------- |
| `express`                         | `^5.0.0`                                    | HTTP server.      |
| `helmet`                          | `^7.1.0`                                    | Security headers. |
| `cookie-parser`                   | (not used — service tokens come via header) | —                 |
| `jsonwebtoken`                    | `^9.0.2`                                    | JWT verify.       |
| `@types/jsonwebtoken`             | `^9.0.6`                                    | Types.            |
| `prisma`, `@prisma/client`        | `^5.20.0`                                   | DB.               |
| `pino` (via `@facturador/logger`) | —                                           | Logs.             |

### 7.3 Conventions

- One module per concept (`certificates/`, `documents/`).
- All public exports from `documents/services/` are pure functions or factories — easier to unit-test.
- No `req` access deep in services. Pass primitives.

## 8. Acceptance criteria

- **AC-1.** `pnpm --filter @facturador/sri-core dev` starts and `curl localhost:3100/healthz` returns 200.
- **AC-2.** A request to `/v1/documents/emit` without the service token returns `401 sri.service_token_invalid`.
- **AC-3.** A request with a JWT whose `aud` is wrong returns `401`.
- **AC-4.** A request with mismatched tenant (JWT `sub` vs body `companyId`) returns `403 tenant.forbidden`.
- **AC-5.** A request with a body larger than 1 MB returns `413` (Express default).
- **AC-6.** Logs of an error path **do not** contain raw XML, signed XML, certificate bytes, or passphrases.
- **AC-7.** `/readyz` reports 503 when the DB is down.

## 9. Test plan

- Integration: valid JWT round-trip → handler reached → returns stub response.
- Unit: `error-mapper.ts` maps every documented SRI `estado` to the expected `AppError.code`.
- Failure-mode unit: tampering JWT signature fails verification.

## 10. Security considerations

- Service tokens are HS256 with a 32-byte secret shared between API and SRI Core. Rotation is a future spec (key versioning header `kid`).
- SRI Core **must** verify `aud` AND `iss` AND `exp`. Skipping any one is a security bug.
- Certificates never logged. See [SPEC-0021](./0021-certificate-management.md) for full encryption details.
- All outbound HTTPS uses the Node global agent **with** `minVersion: 'TLSv1.2'`.

## 11. Observability

- Per-request log fields: `service=sri-core`, `requestId`, `companyId`, `claveAcceso` (when known), `etapa` (when known).
- Timing: log a `duration_ms` summary line on every emit response (success or normalized failure).

## 12. Risks and mitigations

| Risk                                     | Mitigation                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Shared DB drift between API and SRI Core | Foreign keys logical only; reviews enforce a "no cross-table query" rule. |
| Service token replay                     | Short expiry (60 s); future `jti` deny-list if needed.                    |
| Certificate exposure via error response  | `mapSriError` strips XML; redactions in logger block residual leaks.      |

## 13. Open questions

- Switch JWT secret to RS256 (signed by API, verified by SRI Core) when keys can rotate independently? Possible later; HS256 is fine for v1.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
