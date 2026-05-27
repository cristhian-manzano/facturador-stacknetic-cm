# Final Full Project Review

Fecha de revision: 2026-05-25  
Repositorio: `facturador-stacknetic-cm`  
Alcance real encontrado: existen artefactos para `0001`, `0002`, `0003`, `0004`, `0005`, `0006`, `0007`, `0010`, `0011`, `0020`, `0021`, `0022`, `0023`, `0024`, `0025`, `0026`, `0030`, `0031`, `0032`, `0033`, `0040`, `0041`, `0042`, `0043`. No existen prompts/specs/tasks para `0008`, `0009`, `0012-0019`, `0027-0029` ni `0034-0039`; esos IDs quedan como no verificables porque no hay artefactos locales que auditar.

## 1. Executive Summary

- Estado general: **No aprobar / No listo para ejecucion real**.
- El proyecto tiene una base amplia y mucho trabajo implementado: monorepo, contratos, DB, auth, tenant isolation, SRI Core, certificados, clave de acceso, XML de factura, SOAP clients, secuenciacion, catalogo de clientes, facturas y UI de facturas.
- Aun asi, no esta listo porque fallan gates obligatorios (`lint`, `typecheck`, `build`, `format:check`, `test:coverage`) y hay discrepancias criticas entre specs y codigo.
- Bloqueadores principales:
  - Firma XAdES-BES usa `exc-c14n` cuando la documentacion interna exige C14N inclusivo.
  - El frontend valida respuestas de factura con contratos que el API real no devuelve.
  - El orquestador de emision de API no sigue la semantica de SPEC-0033 para `DEVUELTA`, `NO_AUTORIZADO`, `ERROR_RED` ni reemision.
  - SRI Core puede fallar en un segundo fallo de red desde `ERROR_RED` por self-loop sin `allowSelfLoop`.
  - Pipeline de entrega no esta verde.
- Riesgos principales: rechazo de XML firmado por SRI, UI rota al consumir API real, estados contables/fiscales inconsistentes, permisos de `ACCOUNTANT` mas amplios que la spec, y cobertura insuficiente de ramas en API.
- Recomendacion final: **No aprobar**. Corregir bloqueadores criticos antes de considerar staging o pruebas con SRI.

Conteo de hallazgos priorizados:

- Criticos: 6
- Altos: 9
- Medios: 10
- Bajos: 5

## 2. Validation Commands Executed

| Command | Result | Notes | Blocking |
| ------- | ------ | ----- | -------- |
| `pnpm --filter @facturador/db prisma:validate` | PASS | Prisma schema valido. | No |
| `pnpm lint` | FAIL | 309 errores: parser project para scripts/configs, reglas React Hooks no instaladas, `no-unsafe-*`, `no-non-null-assertion`, `restrict-template-expressions`, etc. | Si |
| `pnpm typecheck` | FAIL | Falla primero en `@facturador/db`: `test/test-harness-internals.test.ts(40,12): 'rows' is of type 'unknown'`. | Si |
| `pnpm --filter @facturador/utils typecheck` | PASS | Utils compila aislado. | No |
| `pnpm --filter @facturador/api typecheck` | PASS | API compila aislado. | No |
| `pnpm --filter @facturador/web typecheck` | FAIL | 3 errores TS2339 por `.value` en `HTMLElement` en tests. | Si |
| `pnpm --filter @facturador/sri-core typecheck` | FAIL | 4 errores TS18046 en `src/jobs/poll-en-proceso.ts`: `rows` es `unknown`. | Si |
| `pnpm build` | FAIL | Dentro del sandbox fallo por `tsx` IPC; fuera del sandbox llego a fallo real: `apps/sri-core/src/jobs/poll-en-proceso.ts` no compila por `rows` `unknown`. | Si |
| `pnpm format:check` | FAIL | Prettier reporta 30 archivos con formato pendiente. | Si |
| `pnpm test` | PASS fuera del sandbox | Dentro del sandbox fallo por DB/sockets; fuera del sandbox pasaron workspaces: DB 13, contracts 287, logger 35, utils 152, API 312, SRI Core 397, web 323 tests. Total: 1519 tests. | No, pero requiere entorno con DB/sockets |
| `pnpm --filter @facturador/web test` | PASS | 44 archivos, 323 tests. Warnings de React Router v7 y MSW unhandled requests. | No |
| `pnpm --filter @facturador/sri-core test` | PASS fuera del sandbox | 31 archivos, 397 tests. Dentro del sandbox fallo por `tsx` IPC. | No |
| `pnpm --filter @facturador/api test` | PASS fuera del sandbox | 24 archivos, 312 tests. Dentro del sandbox fallo por sockets/DB. | No |
| `pnpm --filter @facturador/db prisma:migrate:status` | PASS fuera del sandbox | 6 migraciones encontradas; DB local `facturador.public` al dia. Dentro del sandbox no pudo consultar Postgres. | No |
| `pnpm -r --workspace-concurrency=1 test:coverage` | FAIL | Paquetes previos pasaron, pero API falla threshold global: branches 67.47% < 70%. El comando se corta antes de cubrir todo el monorepo. | Si |
| `git status --short` | PASS informativo | Antes y despues de validaciones solo existia `D XXXXXXX-FINAL-DRAFT.md` no relacionado; despues de generar este reporte debe aparecer este archivo nuevo. | No |

Comandos no ejecutados:

- `pnpm dev`: no se ejecuto porque levanta un stack long-lived con Docker. Debe correrse manualmente tras corregir build/typecheck para validar API `:3000`, SRI Core `:3100` y Web `:5173`.

## 3. Overall Readiness Assessment

| Area | Rating | Rationale |
| ---- | ------ | --------- |
| Functional readiness | Partially ready | Muchos flujos estan implementados y testeados, pero facturas reales tienen contrato API/Web roto y reemision/emision no siguen spec. |
| SRI domain readiness | Partially ready | Clave, XML, SOAP y certificados estan avanzados; XAdES tiene un defecto critico de canonicalizacion y no hay validacion con SRI sandbox real. |
| Test readiness | Partially ready | `pnpm test` pasa fuera del sandbox, pero `test:coverage` falla y hay tests que codifican comportamiento contrario a specs. |
| Security readiness | Partially ready | Buen aislamiento por `companyId` en muchos endpoints; RBAC y lifecycle de memberships divergen de SPEC-0011. |
| Architecture readiness | Partially ready | Separacion apps/packages razonable; contratos compartidos no estan alineados con wire real en facturas. |
| Production readiness | Not ready | `lint`, `typecheck`, `build`, `format:check` y coverage fallan. |

## 4. Prompt-by-Prompt Review

### 0001 - Monorepo and Workspace

#### Status
Completado con observaciones.

#### Files Reviewed
`ai/prompts/0001-*`, `ai/specs/0001-*`, `ai/plans/0001-*`, `ai/tasks/0001-*`, `ai/reviews/0001-*`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `apps/*`, `packages/*`.

#### Expected Requirements
Monorepo pnpm, workspaces para apps/packages, TypeScript strict ESM, scripts base, README y estructura inicial.

#### Implementation Found
La estructura existe y los workspaces estan definidos. Los paquetes principales tienen `package.json`, `tsconfig` y scripts. README documenta setup y servicios.

#### Validation Performed
`pnpm -r list --depth -1`, revision manual y comandos globales. Los workspaces son detectados.

#### Findings
- La base del monorepo esta bien.
- Algunos artefactos de bootstrap quedaron obsoletos frente a specs posteriores, pero eso es normal.
- `packages/config/src/index.ts` aun exporta `placeholder`; bajo impacto.

#### Risks
Bajo: confusion menor por placeholders remanentes.

#### Required Fixes
Eliminar placeholders que ya no tengan proposito o documentarlos como intencionales.

#### Recommendation
Mantener aprobado como base, sujeto a corregir gates globales.

### 0002 - Shared Tooling

#### Status
Bloqueado por errores.

#### Files Reviewed
`ai/specs/0002-*`, `eslint.config.js`, `.prettierrc`, `.github/workflows/ci.yml`, package scripts.

#### Expected Requirements
Tooling compartido de ESLint/Prettier/TypeScript y CI con lint/typecheck/test/build.

#### Implementation Found
Tooling existe, pero actualmente no es ejecutable de forma verde.

#### Validation Performed
`pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm -r --workspace-concurrency=1 test:coverage`.

#### Findings
- `pnpm lint` falla con 309 errores.
- `pnpm format:check` falla en 30 archivos.
- `pnpm typecheck` falla en DB, Web y SRI Core.
- `pnpm build` falla en SRI Core.
- `test:coverage` falla por threshold de branches en API.

#### Risks
Critico: CI no puede aprobar; no hay garantia de build producible.

#### Required Fixes
Alinear ESLint con tsconfigs, instalar/configurar plugin React Hooks o remover disables, corregir errores TS, correr Prettier, subir branch coverage o ajustar umbral con decision explicita.

#### Recommendation
No aprobar hasta que todos los gates pasen.

### 0003 - Docker and Local Development

#### Status
No verificable completamente.

#### Files Reviewed
`ai/specs/0003-*`, `README.md`, `.env.example`, `docker-compose.yml`, Dockerfiles de API/SRI/web, `packages/*/src/env.ts`, `apps/*/src/env.ts`.

#### Expected Requirements
Stack local Docker con Postgres, API, SRI Core, Web, Mailhog, envs seguros y health endpoints.

#### Implementation Found
`docker-compose.yml` y Dockerfiles existen; README documenta `pnpm dev`, health endpoints y teardown.

#### Validation Performed
Revision manual; `pnpm dev` no ejecutado por ser long-lived. Tests fuera del sandbox usaron Postgres local y pasaron.

#### Findings
- No se valido arranque Docker completo.
- `.env.example` usa placeholders; `.env` existe localmente pero no se imprimio por seguridad.
- Build falla antes de poder considerar imagenes como listas.

#### Risks
Medio: setup documentado puede no arrancar si build sigue fallando.

#### Required Fixes
Corregir build/typecheck y ejecutar smoke manual: `pnpm dev`, `/health`, `/health-db`, `/healthz`, `/readyz`, UI en `5173`.

#### Recommendation
Aprobar con observaciones solo despues de smoke Docker.

### 0004 - Database and Prisma

#### Status
Completado con observaciones.

#### Files Reviewed
`packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/*`, `packages/db/prisma/seed.ts`, `packages/db/src/test-harness.ts`, DB tests.

#### Expected Requirements
Schema multi-tenant, migraciones, seed seguro, test harness aislado.

#### Implementation Found
Schema y 6 migraciones existen. `prisma validate` pasa. `prisma migrate status` fuera del sandbox confirma DB al dia. Tests DB pasan fuera del sandbox.

#### Validation Performed
`pnpm --filter @facturador/db prisma:validate`, `pnpm --filter @facturador/db prisma:migrate:status`, `pnpm test`.

#### Findings
- Typecheck de `@facturador/db` falla por `rows` `unknown` en test harness.
- `Membership` no tiene `acceptedAt` ni `revokedAt`, aunque SPEC-0011 los exige.
- `BurnedSecuencial` es unico por `(companyId, estab, ptoEmi, secuencial)` y no incluye `tipoComprobante`, pese a que el contador si es por tipo de comprobante.

#### Risks
Alto: lifecycle de membership incompleto y potencial conflicto futuro al soportar nota credito/debito/retencion con mismo secuencial.

#### Required Fixes
Tipar resultados raw, agregar campos de membership lifecycle o ajustar spec, y cambiar unicidad de burned secuenciales a incluir `tipoComprobante` si se confirma espacio por documento.

#### Recommendation
No bloquear por schema base, pero si por typecheck y brechas de integridad.

### 0005 - Shared Contracts

#### Status
Implementacion parcial.

#### Files Reviewed
`packages/contracts/src/**`, `packages/contracts/src/invoices/detail.ts`, `packages/contracts/src/invoices/invoice.ts`, API handlers, Web API wrappers.

#### Expected Requirements
Contratos Zod compartidos y usados por API/Web para evitar drift.

#### Implementation Found
Contratos completos para auth, tenants, customers, SRI, invoices. Tests de contracts pasan.

#### Validation Performed
`pnpm test`, revision manual de contratos vs wire real.

#### Findings
- `InvoiceDetailSchema` exige `{ invoice, customer, sriDocument, sriEvents }`, pero `GET /api/v1/invoices/:id` devuelve un objeto plano de invoice.
- `InvoiceSchema` no permite `null` en `codigoPrincipal`, `codigoAuxiliar`, `unidadMedida`, `plazo`, `unidadTiempo`; API devuelve `null` para esos campos.
- El frontend usa esos contratos en runtime; las respuestas reales fallarian en Zod.

#### Risks
Critico: UI de crear/editar/detalle de facturas puede romperse contra API real.

#### Required Fixes
Definir una unica forma wire: o API devuelve exactamente `InvoiceSchema`/`InvoiceDetailSchema`, o contratos reflejan el wire real. Agregar integration test API response -> contract parse.

#### Recommendation
No aprobar hasta resolver el drift.

### 0006 - Error Model and Logging

#### Status
Completado con observaciones.

#### Files Reviewed
`packages/utils/src/errors/*`, `packages/logger/src/*`, `apps/api/src/middleware/*`, `apps/sri-core/src/middleware/*`, audit helpers/tests.

#### Expected Requirements
ProblemDetail uniforme, request-id, logging redactado, audit trail.

#### Implementation Found
Modelo de errores y auditoria existe; tests pasan fuera del sandbox.

#### Validation Performed
Tests API/SRI/logger/utils, revision de redactions.

#### Findings
- Buen manejo de errores typed y redaccion de secretos comunes.
- Riesgo medio: redaccion por paths no garantiza cobertura profunda para payloads anidados arbitrarios.
- Logs de pruebas muestran errores Prisma esperados; no se observo filtracion de XML/certificados/JWT.

#### Risks
Medio: si se loguean objetos anidados con PII/XML, redaccion puede no cubrir todos los paths.

#### Required Fixes
Agregar tests de redaccion para payloads profundamente anidados y arrays de mensajes SRI; evitar log de cuerpos completos.

#### Recommendation
Aprobable con hardening.

### 0007 - Testing Strategy

#### Status
Completado con observaciones.

#### Files Reviewed
Vitest configs, test harness, tests en API/SRI/Web/Contracts/Utils/DB, `.github/workflows/ci.yml`.

#### Expected Requirements
Tests unitarios/integracion, fixtures sinteticos, coverage y CI.

#### Implementation Found
Hay 1519 tests que pasan fuera del sandbox. Hay cobertura muy amplia, incluido SRI Core, XML, SOAP y concurrencia de secuenciales.

#### Validation Performed
`pnpm test` fuera del sandbox PASS; `test:coverage` FAIL.

#### Findings
- `test:coverage` falla: API branch coverage 67.47% < 70%.
- Algunos tests codifican comportamiento contrario a SPEC-0033, por ejemplo `DEVUELTA` y `ERROR_RED` dejando invoice `EMITIDO`.
- Web tests usan fixtures/MSW con contrato ideal, no respuestas reales del API.

#### Risks
Alto: una suite verde puede ocultar drift de negocio.

#### Required Fixes
Actualizar tests para reflejar specs, agregar contract integration tests y cubrir ramas faltantes de API.

#### Recommendation
No aprobar testing hasta que coverage y drift de expectativas se corrijan.

### 0010 - Authentication and Sessions

#### Status
Completado con observaciones.

#### Files Reviewed
`apps/api/src/auth/*`, `packages/contracts/src/auth/*`, `apps/web/src/auth/*`, `ADR-0004`, tests auth.

#### Expected Requirements
Login, sesiones server-side, cookies, CSRF, logout, `/me`, errores genericos.

#### Implementation Found
Implementacion robusta de sesiones, CSRF y auth flows. Tests API/Web pasan fuera del sandbox.

#### Validation Performed
Tests API auth, Web auth, revision manual.

#### Findings
- Login inicialmente deja `activeCompanyId` null hasta tenant switch.
- Buen patron de cookies httpOnly y CSRF.
- No se encontro filtracion de password/email en errores de login.

#### Risks
Bajo: depende de SPEC-0011 para tenant activo completo.

#### Required Fixes
Mantener pruebas de timing y cookies; documentar configuracion `Secure` por ambiente.

#### Recommendation
Aprobado con dependencia de RBAC/tenancy.

### 0011 - Tenants, Memberships and RBAC

#### Status
Implementacion parcial.

#### Files Reviewed
`ai/specs/0011-*`, `packages/utils/src/rbac/rbac.ts`, `apps/api/src/auth/require-tenant.ts`, `apps/api/src/tenants/*`, Prisma `Membership`, tests tenants.

#### Expected Requirements
Membership invite/accept/revoke, active membership por `acceptedAt != null` y `revokedAt == null`, tenant switch auditado, RBAC segun matriz.

#### Implementation Found
Tenant switch, CRUD parcial y guards existen. Tests cross-tenant y permisos pasan.

#### Findings
- SPEC dice `ACCOUNTANT` solo view para clientes/facturas; codigo permite `customer.create`, `customer.update`, `invoice.create`, `invoice.emit`, `invoice.reissue`.
- `Membership` no tiene `acceptedAt` ni `revokedAt`; borrado de miembro es hard delete.
- No se implemento flujo invite/accept/revoke como tal.

#### Risks
Alto: sobre-autorizacion de contadores y auditoria de membresias incompleta.

#### Required Fixes
Alinear `MATRIX` con SPEC-0011, agregar columnas lifecycle o cambiar spec, implementar invite/accept/revoke y soft revoke, migrar tests para validar ACCOUNTANT read-only.

#### Recommendation
No aprobar seguridad multi-tenant hasta corregir RBAC y membership lifecycle.

### 0020 - SRI Core Service Bootstrap

#### Status
Completado con observaciones.

#### Files Reviewed
`apps/sri-core/src/server.ts`, routes documents/certificates, service JWT, Prisma SRI models, env, tests.

#### Expected Requirements
Servicio SRI Core separado, autenticado por JWT servicio, endpoints base y persistencia `SriDocument`/`SriEvent`.

#### Implementation Found
Servicio existe, valida service JWT, tiene health/ready, documentos, certificados y tests negativos de auth.

#### Validation Performed
SRI Core tests PASS fuera del sandbox.

#### Findings
- Buen aislamiento de SRI Core.
- `SRI_STUB_MODE` facilita dev/test y se bloquea en produccion.
- Algunos warnings/audit FK en test aparecen en stdout pero tests pasan; revisar que no oculten auditoria perdida.

#### Risks
Medio: warnings de FK en audit pueden indicar que auditoria de ciertos caminos no se persiste.

#### Required Fixes
Revisar `safeAudit`/fixtures para que no dependan de company inexistente o para documentar el swallow.

#### Recommendation
Aprobado con observaciones.

### 0021 - Certificate Management

#### Status
Completado con observaciones.

#### Files Reviewed
`apps/sri-core/src/certificates/*`, `apps/sri-core/src/crypto/envelope.ts`, env, certificate routes/tests.

#### Expected Requirements
Upload `.p12`, password por header, parse seguro, cifrado en reposo, activacion atomica, expiry job, no fuga de secreto.

#### Implementation Found
La implementacion cubre upload/list/get/activate/delete, parse, cifrado y cache active cert.

#### Validation Performed
SRI Core certificate tests PASS.

#### Findings
- Buen aislamiento: API/Web no manejan `.p12`.
- Stub mode tolera master key placeholder; non-stub exige key valida.
- La clave privada se importa extractable por limitacion de xadesjs; esta documentado, pero aumenta importancia de no loguear ni retener.

#### Risks
Medio: material sensible en memoria inevitable; necesita observabilidad estricta.

#### Required Fixes
Agregar pruebas de no-log para passphrase/cert/key en todos los errores de upload/sign.

#### Recommendation
Aprobado con hardening.

### 0022 - Clave de Acceso Generator

#### Status
Completado correctamente.

#### Files Reviewed
`packages/utils/src/sri/clave-acceso.ts`, contract primitive, fixtures/tests, API smoke.

#### Expected Requirements
Clave 49 digitos, campos correctos, modulo 11, validaciones y fixtures.

#### Implementation Found
Generador y validador estan bien cubiertos: composicion, modulo 11, codDocs, ramas especiales, crosscheck con contracts.

#### Validation Performed
Utils tests PASS; contracts tests PASS; API smoke PASS.

#### Findings
- Excelente cobertura determinista.
- Observacion: el generador valida RUC como 13 digitos, pero no checksum completo. La validacion de RUC ocurre en contracts/API; si se quiere defensa en profundidad, el generador deberia rechazar RUC invalido.

#### Risks
Bajo: si un caller bypassa contracts, podria generar clave con RUC formalmente invalido.

#### Required Fixes
Opcional: inyectar/usar validador RUC en `buildClaveAcceso`.

#### Recommendation
Aprobado.

### 0023 - XML Builder Factura

#### Status
Completado con observaciones.

#### Files Reviewed
`apps/sri-core/src/xml/factura.ts`, sanitize/validate, XSD, golden fixtures, factura input contracts.

#### Expected Requirements
Construir XML factura V2.1.0, orden XSD, totales/impuestos, escaping, golden/XSD tests.

#### Implementation Found
Builder single-line, root `factura id="comprobante" version="2.1.0"`, escapes, validacion XSD y golden fixtures.

#### Validation Performed
SRI Core XML/XSD tests PASS.

#### Findings
- Buena cobertura para factura.
- No cubre otros comprobantes del producto (`nota_credito`, `nota_debito`, `retencion`), pero eso no parece in-scope de SPEC-0023.
- No hay validacion contra SRI sandbox real.

#### Risks
Medio: correctness fiscal final depende de prueba SRI real y de versiones futuras de XSD.

#### Required Fixes
Agregar fixtures representativos adicionales y una prueba manual/sandbox antes de produccion.

#### Recommendation
Aprobado para factura, no para todo el producto final.

### 0024 - XAdES-BES Signer

#### Status
Bloqueado por errores.

#### Files Reviewed
`ai/specs/0024-*`, `docs/sri-facturacion-electronica-ecuador.md`, `apps/sri-core/src/xml/sign.ts`, `apps/sri-core/src/xml/verify.ts`, sign tests.

#### Expected Requirements
XAdES-BES enveloped, URI `#comprobante`, transforms `enveloped-signature` + C14N inclusivo, SignedProperties, local verification.

#### Implementation Found
Signer usa xadesjs, SignedProperties, X509Data, SHA1/SHA256, local verify y tests.

#### Findings
- Defecto critico: `apps/sri-core/src/xml/sign.ts` configura `transforms: ["enveloped", "exc-c14n"]`. SPEC-0024 y docs internas exigen `http://www.w3.org/TR/2001/REC-xml-c14n-20010315` inclusivo, no exclusivo.
- Tests validan round-trip con la misma libreria pero no que los URIs de canonicalizacion/transforms sean los exigidos por SRI.
- La spec FR-6 habla de preservar declaracion XML; la implementacion exige `xmlForSigning` sin declaracion y devuelve cuerpo firmado sin declaracion. Puede ser aceptable si caller la agrega, pero contradice la spec.

#### Risks
Critico: SRI puede rechazar la firma aunque `verifySignedXml` local pase.

#### Required Fixes
Cambiar transforms a C14N inclusivo, assertar `CanonicalizationMethod` y `Transform Algorithm` exactos en tests, validar signed XML contra fixture compatible SRI/sandbox.

#### Recommendation
No aprobar SRI hasta corregir.

### 0025 - SRI SOAP Clients

#### Status
Completado con observaciones.

#### Files Reviewed
`apps/sri-core/src/soap/*`, fixtures SOAP, tests clients/parse/retry/envelopes.

#### Expected Requirements
Clientes recepcion/autorizacion, endpoints por ambiente, timeouts, retries, parsing robusto y mocks.

#### Implementation Found
Clientes y parser SOAP existen; tests cubren RECIBIDA, DEVUELTA, AUTORIZADO, NO_AUTORIZADO, EN_PROCESO, error 43 y retries.

#### Validation Performed
SRI Core SOAP tests PASS.

#### Findings
- Buen manejo de `?wsdl`, TLS, timeouts y errores.
- No se encontro stream/body cap duro para respuestas enormes.
- No se ejecuto contra SRI real.

#### Risks
Medio: un XML SOAP inesperadamente grande o forma no fixtureada puede impactar memoria/parse.

#### Required Fixes
Agregar limite de bytes de respuesta y smoke manual contra endpoint de pruebas.

#### Recommendation
Aprobado con hardening.

### 0026 - Document Lifecycle and Jobs

#### Status
Implementacion parcial.

#### Files Reviewed
`apps/sri-core/src/lifecycle/*`, `apps/sri-core/src/jobs/poll-en-proceso.ts`, Prisma SRI models, lifecycle/job tests.

#### Expected Requirements
State machine, transiciones validas, eventos atomicos, retry/polling, idempotencia y jobs.

#### Implementation Found
State machine, `recordEvent`, `emitFactura`, poll job y tests existen.

#### Findings
- Bug critico: desde `ERROR_RED`, si reintento de recepcion vuelve a fallar, `emitFactura` llama `recordEvent(... estado: "ERROR_RED")` sin `allowSelfLoop`. `recordEvent` rechaza self-loop por defecto. Resultado: error `sri.invalid_transition` en vez de permanecer en `ERROR_RED`.
- `canTransition` permite `ERROR_RED -> ERROR_RED`, pero el caller no activa self-loop.
- Build/typecheck de `poll-en-proceso.ts` falla por `rows` `unknown`.

#### Risks
Critico: retries de red repetidos pueden romper el ciclo de recuperacion.

#### Required Fixes
Agregar `allowSelfLoop: true` en caminos de re-confirmacion `ERROR_RED`/`EN_PROCESO`, testear fallo de red repetido, tipar raw queries del poll job.

#### Recommendation
No aprobar lifecycle hasta corregir retry y typecheck.

### 0030 - Emission Points and Sequencing

#### Status
Completado con observaciones.

#### Files Reviewed
`apps/api/src/establecimientos/*`, `apps/api/src/sequencing/*`, Prisma `SecuencialCounter`/`BurnedSecuencial`, tests establecimientos.

#### Expected Requirements
Establecimientos, puntos de emision, secuenciales atomicos por tenant/estab/ptoEmi/tipoComprobante, burns, concurrencia.

#### Implementation Found
CRUD y reserva con transaccion serializable existen. Test de 2000 reservas concurrentes pasa fuera del sandbox.

#### Findings
- `SecuencialCounter` es correcto por `(companyId, estab, ptoEmi, tipoComprobante)`.
- `BurnedSecuencial` no incluye `tipoComprobante` en su unique, contradiciendo el comentario que indica que el espacio es por codDoc.
- En SPEC-0033, reserva + update de invoice deberia ser una unica transaccion; actualmente `reserveSecuencial` y `invoice.update` son transacciones separadas.

#### Risks
Alto: futuros comprobantes pueden colisionar burns; fallos entre reserva y update dejan gap sin auditoria burn si no se compensa.

#### Required Fixes
Revisar unique de `BurnedSecuencial`; envolver reserva+persistencia de factura en una unidad transaccional o registrar burn compensatorio ante fallo intermedio.

#### Recommendation
Aprobado parcialmente; necesita ajustes antes de ampliar a otros comprobantes.

### 0031 - Customer Catalog

#### Status
Completado con observaciones.

#### Files Reviewed
`apps/api/src/customers/*`, `packages/contracts/src/customers/*`, Prisma `Customer`, tests customers, web customer combobox/dialog.

#### Expected Requirements
CRUD tenant-scoped, validacion por tipo identificacion, consumidor final, soft delete, RBAC.

#### Implementation Found
Implementado y testeado ampliamente; cross-tenant y consumidor final cubiertos.

#### Validation Performed
API tests PASS; web tests PASS.

#### Findings
- Buenas validaciones de RUC/cedula/pasaporte/exterior/consumidor final.
- PII se excluye de lista y aparece en detalle segun spec.
- RBAC depende de matriz 0011, donde ACCOUNTANT esta demasiado permisivo.

#### Risks
Alto por RBAC heredado, no por catalogo en si.

#### Required Fixes
Corregir matriz y agregar test ACCOUNTANT no crea/actualiza clientes si esa es la regla final.

#### Recommendation
Aprobado condicionado a RBAC.

### 0032 - Invoice Domain

#### Status
Implementacion parcial.

#### Files Reviewed
`apps/api/src/invoices/*`, contracts invoices, Prisma invoice models, tests invoices, web form payload.

#### Expected Requirements
Draft invoices, totales server-side, validaciones, list/detail, tenant isolation, bloqueo de edit/delete tras emision.

#### Implementation Found
CRUD draft, compute totals, preview, list, detail, update/delete y tests existen.

#### Findings
- Calculo de totales y validacion de pagos estan bien cubiertos.
- Wire de detalle/create/update no parsea con `InvoiceSchema` por `null` vs optional y campos extra/faltantes.
- API detail no devuelve aggregate requerido por `InvoiceDetailSchema`.

#### Risks
Critico para UI real de facturas.

#### Required Fixes
Alinear wire/contract y agregar prueba de `InvoiceSchema.parse(toInvoiceDetailWire(row))` o reemplazar schema con wire real.

#### Recommendation
No aprobar hasta resolver contratos.

### 0033 - Invoice Emission Orchestrator

#### Status
Bloqueado por errores.

#### Files Reviewed
`apps/api/src/invoices/orchestrator.ts`, `translate-to-sri.ts`, `apps/api/src/sri/client.ts`, tests invoices, SPEC-0033.

#### Expected Requirements
Flujo crear/validar/clave/XML/firma/SRI/persistir/estado frontend; idempotencia; secuenciales seguros; reissue con nuevo documento emitido; estados segun outcome SRI.

#### Implementation Found
Emit llama SRI Core, genera clave y secuencial, mirror `sriEstado`, refresh y reissue existen.

#### Findings
- `reserveInTransaction` pone `estado: "EMITIDO"` antes de llamar SRI Core.
- Si SRI Core falla por red, invoice queda `EMITIDO + ERROR_RED`; SPEC-0033 dice que deberia quedar `BORRADOR` con secuencial consumido.
- `DEVUELTA`/`NO_AUTORIZADO` dejan invoice `EMITIDO`, impidiendo correccion normal de borrador.
- `reissue` solo crea un nuevo `BORRADOR`; no emite inmediatamente, no marca fuente `ANULADO`, no persiste relacion entre documentos.
- `applyMirror` ignora `numeroAutorizacion` y `fechaAutorizacion`.

#### Risks
Critico: estados fiscales y UX operacional pueden ser incorrectos, y reintentos pueden generar documentos duplicados o no corregibles.

#### Required Fixes
Reimplementar segun SPEC-0033: reserva/update atomicos, outcome map correcto, old invoice `ANULADO` en reissue si aplica, link old/new, persistencia de autorizacion o join real con SRI Core, tests actualizados.

#### Recommendation
No aprobar.

### 0040 - Web App Bootstrap

#### Status
Completado con observaciones.

#### Files Reviewed
`apps/web/src/router.tsx`, providers, auth layout, Vite config, Tailwind, tests web.

#### Expected Requirements
Vite React app, router, layout, auth guards y API client base.

#### Implementation Found
Web app compila con Vite durante `pnpm build` hasta que SRI Core falla. Web tests pasan.

#### Findings
- Bootstrap funcional.
- Web typecheck falla por tests con `.value` en `HTMLElement`.
- Warnings React Router v7 y MSW unhandled requests en tests.

#### Risks
Medio: typecheck bloquea CI; warnings pueden ocultar problemas de mocks.

#### Required Fixes
Tipar elementos de tests (`HTMLInputElement`/`HTMLSelectElement`), completar handlers MSW o marcar passthrough explicito.

#### Recommendation
Aprobar tras corregir typecheck.

### 0041 - Web Auth Flows

#### Status
Completado con observaciones.

#### Files Reviewed
`apps/web/src/auth/*`, `LoginPage`, `TenantSelectPage`, tenant switcher, API auth handlers/contracts.

#### Expected Requirements
Login/logout/me, tenant selection, guards, CSRF, forbidden route.

#### Implementation Found
Flujos implementados y testeados.

#### Validation Performed
Web tests PASS; API auth tests PASS.

#### Findings
- Buen manejo de loading/error/forbidden.
- Depende de membership lifecycle incompleto de SPEC-0011.

#### Risks
Medio: una membresia removida por hard delete funciona, pero no hay invitaciones/revokes auditables como spec.

#### Required Fixes
Actualizar auth UI/API cuando se agregue invite/accept/revoke.

#### Recommendation
Aprobado condicionado a 0011.

### 0042 - Web Invoice Create

#### Status
Implementacion parcial.

#### Files Reviewed
`apps/web/src/invoices/form/*`, hooks, money/tax utilities, invoice API wrappers, API invoice create/preview/emit.

#### Expected Requirements
Crear/editar borrador, cliente, preview totals, autosave, emit modal y manejo de errores.

#### Implementation Found
UI rica y testeada; consume wrappers Zod.

#### Findings
- `createInvoiceDraft` y `updateInvoiceDraft` validan con `InvoiceSchema`, pero API devuelve nulls en campos que schema no acepta.
- Tests de UI no ejercitan el API real; usan fixtures que ya cumplen el contrato esperado por frontend.
- Emit modal interpreta outcomes, pero API state machine esta desviada.

#### Risks
Critico: flujo crear/editar puede fallar al primer response real del backend.

#### Required Fixes
Alinear contratos y agregar test de integracion Web wrapper contra fixture generado desde API real.

#### Recommendation
No aprobar hasta resolver contract drift.

### 0043 - Web Invoice List and Detail

#### Status
Bloqueado por errores.

#### Files Reviewed
`apps/web/src/routes/invoices.index.tsx`, `apps/web/src/routes/invoices.$id.tsx`, components detail/list, `apps/web/src/invoices/api.ts`, API list/detail/refresh/reissue.

#### Expected Requirements
Listado filtrable/paginado, detalle con customer/SRI timeline, polling bounded, acciones por estado/rol.

#### Implementation Found
UI existe, tests pasan, pero depende de `InvoiceDetailSchema` aggregate.

#### Findings
- `GET /api/v1/invoices/:id` real devuelve invoice plano; UI espera `{ invoice, customer, sriDocument, sriEvents }`.
- `refreshInvoice` espera `InvoiceDetailSchema`; API devuelve `{ sriEstado, claveAcceso, numeroAutorizacion, fechaAutorizacion, invoice }`.
- API no sirve eventos SRI al frontend, aunque UI renderiza timeline.
- Placeholders para RIDE/XML son correctos para scope.

#### Risks
Critico: detalle/polling/timeline no funcionaran contra backend real.

#### Required Fixes
Implementar endpoint aggregate o cambiar frontend al wire real. Si se mantiene timeline, API debe consultar SRI Core status/eventos y devolverlos.

#### Recommendation
No aprobar.

## 5. SRI Domain Review

### Clave de acceso

Estado: fuerte. `buildClaveAcceso` compone 48 digitos + modulo 11 y tests cubren longitud, check digit, codDocs y fixtures. Falta defensa en profundidad de checksum RUC dentro del generador si se quiere blindar callers.

### XML factura

Estado: bueno para factura. Builder respeta estructura, orden XSD, escaping, totales, impuestos por detalle y golden/XSD tests. No cubre documentos no-factura del producto.

### XAdES-BES

Estado: no listo. La documentacion interna `docs/sri-facturacion-electronica-ecuador.md` exige C14N inclusivo y explicitly "C14N exclusivo no". El codigo usa `exc-c14n`. Esto debe corregirse y testearse por URI exacto, no solo round-trip local.

### SOAP clients

Estado: razonable. Endpoints por ambiente, envelopes, parser, retries, timeouts y fixtures estan implementados. Falta cap de respuesta y smoke SRI real.

### Document lifecycle

Estado: parcial. State machine y eventos son buenos, pero `ERROR_RED` self-loop falla si se repite un error de red. Poll job no compila por typecheck.

### Sequencing

Estado: parcial. Reserva serializable pasa stress test. Riesgos: burn uniqueness no incluye `tipoComprobante`; reserva y update de invoice no son una transaccion unica.

### Invoice emission orchestration

Estado: no listo. API marca `EMITIDO` antes de conocer resultado SRI, deja outcomes negativos como `EMITIDO`, no cumple reissue de SPEC-0033, y no expone/persiste metadata de autorizacion de forma duradera.

### Error handling

Estado: bueno a nivel de ProblemDetail/SOAP, parcial en lifecycle. Network errors se normalizan, pero repeated `ERROR_RED` puede terminar en conflicto interno.

### Idempotency

Estado: parcial. SRI Core idempotency tiene tests; API idempotency de `EMITIDO` evita doble envio, pero la definicion de `EMITIDO` incluye fallos/DEVUELTA, lo que bloquea correccion y reintentos esperados.

### SRI environment handling

Estado: bueno. Ambiente deriva de company/env; stub mode bloqueado en produccion.

### Fixtures and tests

Estado: bueno en volumen, incompleto en compatibilidad real. Hay golden XML, XSD, SOAP fixtures y synthetic certs. Falta assert exacto de canonicalization y prueba sandbox SRI.

## 6. Architecture Review

### Strengths

- Separacion clara `apps/api`, `apps/sri-core`, `apps/web`, `packages/contracts`, `packages/db`, `packages/utils`, `packages/logger`.
- SRI Core mantiene certificados y firma fuera de API/Web.
- Contratos Zod y tests abundantes.
- Secuenciales usan transacciones serializables y tests de concurrencia.
- Tenant isolation por `companyId` se aplica en muchos repos/handlers.

### Weaknesses

- Contratos compartidos no son la fuente de verdad real para facturas: API y Web divergen.
- Tests verdes en Web/API validan expectativas internas pero no el wire integrado.
- Algunos comentarios dicen "atomico" o "mirror columns" aunque el schema/codigo no lo cumple.
- Producto declara cuatro comprobantes; milestone implementa principalmente factura.

### Coupling issues

- Web depende de contracts aggregate que API no implementa.
- API depende de SRI Core para metadata que no persiste ni sirve durablemente.
- Reissue mezcla burn/clone pero no orquesta nueva emision.

### Scalability issues

- `BurnedSecuencial` no esta preparado para varios `tipoComprobante` con mismo secuencial.
- Falta estrategia de servir XML/RIDE blobs al frontend.

### Maintainability issues

- Lint/typecheck rotos reducen confianza.
- Prettier pendiente en 30 archivos.
- Tests codifican comportamiento contradictorio con specs.

### Package boundaries

En general adecuados. La frontera mas debil es contracts/API/Web para invoices.

### Suggested improvements

Crear pruebas contractuales generadas desde handlers reales; introducir un "wire mapper" compartido o contratos por endpoint; documentar oficialmente si SPEC-0033 cambia de semantics.

## 7. Security Review

### Auth/session

Fuerte: sesiones server-side, CSRF, cookies, logout, `/me`, errores genericos. Tests pasan.

### RBAC

No listo: `ACCOUNTANT` tiene permisos de escritura/emision/reeemision que la spec no le da.

### Tenant isolation

Mayormente fuerte: muchas pruebas cross-tenant retornan 404/403. Riesgo en membership lifecycle por ausencia de `revokedAt`.

### Certificates/secrets

Bien aislados en SRI Core. No se vieron secretos impresos. Mantener estricta redaccion.

### Logging

Bueno en paths comunes. Agregar pruebas deep nested y evitar logs de mensajes SRI completos con PII.

### Input validation

Fuerte en contracts/API para customers/invoices; faltan algunas defensas DB-level.

### Frontend/backend authorization consistency

UI usa permisos de `/me`, pero backend es autoridad. Corregir matriz RBAC primero.

## 8. Database and Data Integrity Review

### Schema

Completo para milestone, pero `Membership` no implementa lifecycle y `Invoice` no guarda autorizacion.

### Migrations

6 migraciones, DB local al dia.

### Constraints

Buenas uniques principales. Brecha: `BurnedSecuencial` unique sin `tipoComprobante`.

### Indexes

Adecuados para listados y polling basico.

### Transactions

Buenas en secuencial counter y membership last-owner. Brecha en API emission reservation + invoice update.

### Consistency

Riesgo alto en invoice state/outcome y reissue.

### Tenant safety

Buena en queries revisadas, con pruebas cross-tenant. Faltan accepted/revoked memberships.

### Sequential numbering

Concurrencia probada. La politica de burns debe alinearse con multiples tipos de comprobante.

## 9. Testing Review

### Tests existentes

- DB: 13 tests.
- Contracts: 287 tests.
- Logger: 35 tests.
- Utils: 152 tests.
- API: 312 tests.
- SRI Core: 397 tests.
- Web: 323 tests.
- Total `pnpm test`: 1519 tests PASS fuera del sandbox.

### Tests faltantes

- XAdES exact URI tests para C14N inclusivo.
- Test de repeated `ERROR_RED -> ERROR_RED` en SRI Core.
- API/Web real contract tests para invoice create/detail/refresh.
- Tests de ACCOUNTANT read-only segun SPEC-0011.
- Tests de reissue segun SPEC-0033: old invoice `ANULADO`, new invoice emitted, link persisted.
- Tests de autorizacion metadata durable en API detail/list.
- Tests para burn por `tipoComprobante`.
- SRI sandbox/manual integration test.

### Coverage gaps

`pnpm -r --workspace-concurrency=1 test:coverage` falla porque API branch coverage queda en 67.47%, bajo threshold 70%.

### Critical tests required before production

1. Golden signed XML with inclusive C14N asserted by URI.
2. End-to-end factura emission against SRI sandbox with synthetic data.
3. API response contract parse tests for all invoice endpoints consumed by Web.
4. Race test around API emit reservation + failed persistence.
5. Negative RBAC matrix for all roles/actions matching spec.

## 10. Critical Blockers

### CB-1: Pipeline de entrega no esta verde

- Evidencia: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm format:check`, `test:coverage` fallan.
- Impacto: no se puede producir release confiable ni aprobar CI.
- Fix recomendado: corregir errores lint/TS, formatear, reparar `poll-en-proceso.ts`, subir coverage branches API.
- Prioridad: Critico.

### CB-2: XAdES usa canonicalizacion exclusiva incompatible con docs internas

- Evidencia: `apps/sri-core/src/xml/sign.ts` usa `transforms: ["enveloped", "exc-c14n"]`; docs/spec exigen C14N inclusivo.
- Impacto: rechazo por SRI aunque verification local pase.
- Fix recomendado: usar transform C14N inclusivo y agregar asserts de URI exacto.
- Prioridad: Critico.

### CB-3: Contrato API/Web de facturas esta roto

- Evidencia: Web usa `InvoiceDetailSchema`; API devuelve wire plano. API devuelve nulls no aceptados por `InvoiceSchema`.
- Impacto: UI de facturas falla en runtime al parsear respuestas reales.
- Fix recomendado: alinear endpoint y contracts; agregar integration tests.
- Prioridad: Critico.

### CB-4: Orquestador API de emision no cumple SPEC-0033

- Evidencia: invoice pasa a `EMITIDO` antes de SRI Core; `ERROR_RED`/`DEVUELTA` quedan `EMITIDO`; metadata de autorizacion no se persiste.
- Impacto: estados fiscales incorrectos, UX de correccion rota, riesgo operativo.
- Fix recomendado: reimplementar mapping de estados/outcomes y persistencia durable.
- Prioridad: Critico.

### CB-5: Reissue incompleto

- Evidencia: `reissue` solo quema y clona `BORRADOR`; no emite nuevo documento, no anula/linkea fuente.
- Impacto: no cumple flujo de correccion/reemision especificado.
- Fix recomendado: old invoice `ANULADO`, link old/new, emitir nuevo o documentar cambio de spec y ajustar UI/tests.
- Prioridad: Critico.

### CB-6: Retry repetido desde `ERROR_RED` puede lanzar `sri.invalid_transition`

- Evidencia: `emitFactura` registra `ERROR_RED` sin `allowSelfLoop`; `recordEvent` rechaza self-loop.
- Impacto: reintentos de red pueden fallar con conflicto interno.
- Fix recomendado: `allowSelfLoop: true` en retry bookkeeping y test dedicado.
- Prioridad: Critico.

## 11. High Priority Issues

1. RBAC `ACCOUNTANT` demasiado permisivo frente a SPEC-0011.
2. `Membership` sin `acceptedAt`/`revokedAt` ni invite/accept/revoke.
3. `numeroAutorizacion`/`fechaAutorizacion` no se persisten ni se exponen durablemente en API detail.
4. `BurnedSecuencial` unique no incluye `tipoComprobante`.
5. Reserva secuencial + update de invoice no son una sola transaccion en API.
6. API no entrega `sriEvents`/timeline real a Web.
7. Tests de XAdES no assertan canonicalization/transforms exactos ni compatibilidad SRI.
8. Tests API codifican comportamiento no-spec para `DEVUELTA`/`ERROR_RED`.
9. Producto declara cuatro comprobantes, pero readiness real cubre principalmente factura.

## 12. Medium/Low Priority Issues

### Medium

1. Config de ESLint incluye archivos fuera de tsconfigs.
2. Falta plugin/config para `react-hooks/exhaustive-deps` o sobran disables.
3. Prettier pendiente en 30 archivos.
4. Web tests tienen MSW unhandled request warnings.
5. SRI Core tests imprimen FK audit warning en un camino.
6. `pnpm dev`/Docker full stack no fue smokeado.
7. Redaccion de logs no demuestra cobertura profunda para payloads anidados.
8. Faltan CHECK constraints DB para codigos/longitudes criticas.
9. No hay validacion SRI sandbox real.
10. Descarga XML/RIDE aun placeholder, aceptable por scope pero pendiente para operacion.

### Low

1. React Router v7 future warnings.
2. `UserConfig` de Vite deprecado en config.
3. Todos los `ai/tasks` siguen con checkboxes sin marcar; no sirven como fuente de estado.
4. `packages/config/src/index.ts` placeholder.
5. Seed password dev placeholder debe seguir bloqueado/overrideado fuera de dev.

## 13. Recommended Implementation Plan

1. Critical blockers
   - Corregir `lint`, `format`, `typecheck`, `build`.
   - Corregir XAdES C14N inclusivo y tests.
   - Alinear contracts/API/Web para facturas.
   - Rehacer emission/reissue semantics segun SPEC-0033.
   - Corregir `ERROR_RED` self-loop.

2. SRI correctness
   - Agregar signed XML golden con URIs exactos.
   - Ejecutar sandbox SRI para factura autorizada.
   - Persistir/exponer autorizacion y eventos.

3. Data integrity
   - Revisar `BurnedSecuencial` unique.
   - Hacer atomica reserva+persistencia invoice o compensar burns.
   - Agregar lifecycle columns para memberships.

4. Security
   - Alinear RBAC.
   - Tests negativos por rol/accion.
   - Hardening de redaccion nested.

5. Tests
   - Corregir coverage API branches.
   - Agregar contract integration tests.
   - Ajustar tests que actualmente validan comportamiento contrario a spec.

6. Architecture cleanup
   - Definir DTOs por endpoint.
   - Documentar si SRI Core sera fuente de timeline o si API tendra replica.
   - Preparar extension para nota credito/debito/retencion.

7. UX/frontend polish
   - Resolver warnings de mocks.
   - Manejar respuestas reales de error/empty/loading.
   - Implementar downloads/RIDE cuando backend sirva blobs.

## 14. Final Verdict

- ¿Esta todo implementado segun specs? **No**. Hay drift critico en SPEC-0011, SPEC-0024, SPEC-0026, SPEC-0033 y SPEC-0043.
- ¿Esta validado con tests? **Parcialmente**. `pnpm test` pasa fuera del sandbox, pero coverage, lint, typecheck y build fallan; ademas hay tests que validan comportamiento contrario a la spec.
- ¿La logica SRI parece correcta? **Parcialmente**. Clave/XML/SOAP son fuertes; XAdES y lifecycle retry no estan listos.
- ¿El proyecto esta listo para ejecutarse? **No**. El build falla y la UI de facturas no es compatible con el API real.
- ¿Que debe hacerse antes de considerarlo terminado? Corregir los 6 blockers criticos, alinear contratos, hacer green todos los gates, y validar al menos una factura firmada/autorizada contra SRI pruebas o un fixture certificado por la documentacion interna.
