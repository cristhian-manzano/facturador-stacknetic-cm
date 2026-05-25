---
id: SPEC-0025
title: SRI SOAP clients (recepción + autorización)
status: draft
owner: TBD
created: 2026-05-19
updated: 2026-05-19
depends_on: [SPEC-0006, SPEC-0020, SPEC-0024]
blocks: [SPEC-0026, SPEC-0033]
---

# SPEC-0025 — SRI SOAP clients

## 1. Purpose

Talk to the SRI's two SOAP web services — **Recepción** and **Autorización** — reliably and resiliently. Encapsulate transport (HTTPS, TLS, timeouts, retries), envelope construction, and response parsing. Hand the rest of SRI Core a normalized result.

## 2. Scope

### 2.1 In scope

- `sendRecepcion(signedXml: Buffer, ambiente): Promise<RecepcionResult>`.
- `consultarAutorizacion(claveAcceso: string, ambiente): Promise<AutorizacionResult>`.
- HTTPS agent with TLS ≥ 1.2 and keep-alive.
- Per-call timeout (default 30 s).
- Bounded retries on **transient** failures (timeout, ECONNRESET, 5xx). **No** retry on business rejections (`DEVUELTA`, `NO AUTORIZADO`).
- Resilient response parsing with namespace fallbacks (per docs §11).
- Normalised result types.

### 2.2 Out of scope

- The polling loop / state machine — [SPEC-0026](./0026-document-lifecycle-and-jobs.md).
- Persistence of events — [SPEC-0026](./0026-document-lifecycle-and-jobs.md) writes them.

## 3. Context & references

- [`docs/sri-facturacion-electronica-ecuador.md`](../../docs/sri-facturacion-electronica-ecuador.md) §11, §14 — envelopes and error catalog.
- [`ai/context/sri-domain.md`](../context/sri-domain.md) — Lifecycle.

## 4. Functional requirements

- **FR-1.** `sendRecepcion`:
  - Builds SOAP envelope per docs §11 with `<xml>{base64(signedXml)}</xml>`.
  - Headers: `Content-Type: text/xml; charset=utf-8`, `SOAPAction: ""`.
  - POST to the configured `RECEPCION` URL for the given `ambiente`.
  - Returns:
    ```ts
    interface RecepcionResult {
      estado: "RECIBIDA" | "DEVUELTA";
      claveAcceso?: string;
      mensajes: Mensaje[];
      durationMs: number;
      httpStatus: number;
      rawXmlSha256: string; // for debug correlation; never log the body itself
    }
    ```
- **FR-2.** `consultarAutorizacion`:
  - Builds SOAP envelope with `<claveAccesoComprobante>{clave}</claveAccesoComprobante>`.
  - POST to the AUTORIZACION URL for the ambiente.
  - Returns:
    ```ts
    interface AutorizacionResult {
      estado: "AUTORIZADO" | "NO_AUTORIZADO" | "EN_PROCESO" | "DESCONOCIDO";
      numeroAutorizacion?: string;
      fechaAutorizacion?: string; // ISO 8601 with offset
      ambiente: "PRODUCCION" | "PRUEBAS" | "DESCONOCIDO";
      mensajes: Mensaje[];
      authorizedXml?: string; // extracted from <comprobante><![CDATA[...]]></comprobante>; never logged
      durationMs: number;
      httpStatus: number;
    }
    ```
- **FR-3.** Mensaje type:
  ```ts
  interface Mensaje {
    identificador: string;
    mensaje: string;
    informacionAdicional?: string;
    tipo: "ERROR" | "ADVERTENCIA" | "INFORMATIVO";
  }
  ```
- **FR-4.** Retry policy: exponential backoff starting at 1 s, 2 s, 4 s, 8 s, cap at 16 s, max 4 retries (total ~ 31 s additional latency in worst case). Retries apply **only** when:
  - `error.code` is `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`.
  - HTTP status is 5xx.
  - Idempotent (always idempotent for these two endpoints).
- **FR-5.** Hard timeout per attempt: env `SRI_HTTP_TIMEOUT_MS` (default 30000).
- **FR-6.** Response parser uses XPath with both namespaced and non-namespaced fallbacks (docs §11).

## 5. Non-functional requirements

- **NFR-1.** Connection reuse via `https.Agent({ keepAlive: true })`.
- **NFR-2.** No raw SOAP/XML bodies in logs. Only digests, statuses, identifiers, durations.
- **NFR-3.** Memory: SOAP responses up to ~2 MB (the autorización response embeds the signed XML); streams capped at 5 MB.

## 6. Technical design

### 6.1 Layout

```
apps/sri-core/src/sri/
├── soap-agent.ts          # https.Agent singleton
├── envelopes/
│   ├── recepcion.ts       # buildRecepcionEnvelope
│   └── autorizacion.ts    # buildAutorizacionEnvelope
├── parsers/
│   ├── recepcion.ts
│   └── autorizacion.ts
├── http.ts                # postXml() with retry
└── index.ts               # sendRecepcion, consultarAutorizacion
```

### 6.2 HTTPS agent

```ts
// apps/sri-core/src/sri/soap-agent.ts
import https from "node:https";
export const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 16,
  minVersion: "TLSv1.2",
});
```

### 6.3 Envelope builders

```ts
// recepcion.ts
export const buildRecepcionEnvelope = (signedXmlBase64: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.recepcion">` +
  `<soapenv:Header/>` +
  `<soapenv:Body>` +
  `<ec:validarComprobante>` +
  `<xml>${signedXmlBase64}</xml>` +
  `</ec:validarComprobante>` +
  `</soapenv:Body>` +
  `</soapenv:Envelope>`;

// autorizacion.ts
export const buildAutorizacionEnvelope = (claveAcceso: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.autorizacion">` +
  `<soapenv:Header/>` +
  `<soapenv:Body>` +
  `<ec:autorizacionComprobante>` +
  `<claveAccesoComprobante>${claveAcceso}</claveAccesoComprobante>` +
  `</ec:autorizacionComprobante>` +
  `</soapenv:Body>` +
  `</soapenv:Envelope>`;
```

### 6.4 HTTP transport with retry

```ts
// http.ts
import { fetch } from "undici";
import { agent } from "./soap-agent.js";
import { env } from "../env.js";

const TRANSIENT_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"]);
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

export interface PostResult {
  status: number;
  body: string;
  durationMs: number;
}

export const postXml = async (url: string, xml: string): Promise<PostResult> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
        body: xml,
        dispatcher: agent as any, // undici accepts Node agent via custom dispatcher; otherwise drop and use built-in agent
        signal: AbortSignal.timeout(env.SRI_HTTP_TIMEOUT_MS),
      });
      const body = await res.text();
      const result = { status: res.status, body, durationMs: Date.now() - started };
      if (res.status >= 500 && attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]!);
        continue;
      }
      return result;
    } catch (e: unknown) {
      lastErr = e;
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (!TRANSIENT_CODES.has(code) && (e as Error).name !== "TimeoutError") throw e;
      if (attempt < BACKOFF_MS.length) await sleep(BACKOFF_MS[attempt]!);
      else throw e;
    }
  }
  throw lastErr;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
```

> Note: if `undici` agent integration is awkward, use the built-in `fetch` agent (`globalDispatcher`) or `axios` with `httpsAgent: agent`. The contract above (timeout + retry) is what matters.

### 6.5 Parsers (resilient to namespace variability)

```ts
// parsers/recepcion.ts
import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";

const select = (doc: Document, expr: string, ns?: Record<string, string>) =>
  (ns ? xpath.useNamespaces(ns) : xpath.select)(expr, doc);

export const parseRecepcion = (
  xmlBody: string,
): { estado: "RECIBIDA" | "DEVUELTA"; claveAcceso?: string; mensajes: Mensaje[] } => {
  const doc = new DOMParser().parseFromString(xmlBody, "application/xml");

  const estado = (
    select(
      doc,
      "//*[local-name()='RespuestaRecepcionComprobante']/*[local-name()='estado']/text()",
    )?.[0]?.toString() ?? ""
  ).trim();
  const claveAcceso = select(doc, "//*[local-name()='claveAcceso']/text()")?.[0]?.toString();

  const mensajeNodes = select(
    doc,
    "//*[local-name()='mensajes']/*[local-name()='mensaje']",
  ) as Element[];
  const mensajes: Mensaje[] = (mensajeNodes ?? []).map((n) => ({
    identificador: textOf(n, "identificador"),
    mensaje: textOf(n, "mensaje"),
    informacionAdicional: textOf(n, "informacionAdicional") || undefined,
    tipo: (textOf(n, "tipo") || "INFORMATIVO") as "ERROR" | "ADVERTENCIA" | "INFORMATIVO",
  }));

  return { estado: (estado as "RECIBIDA" | "DEVUELTA") || "DEVUELTA", claveAcceso, mensajes };
};

const textOf = (parent: Element, tagLocalName: string): string => {
  const nodes = xpath.select(`./*[local-name()='${tagLocalName}']/text()`, parent) as any[];
  return nodes[0]?.toString() ?? "";
};
```

`parsers/autorizacion.ts` follows the same pattern, additionally extracting `<comprobante>` CDATA as `authorizedXml`.

### 6.6 Top-level API

```ts
// apps/sri-core/src/sri/index.ts
import { buildRecepcionEnvelope } from "./envelopes/recepcion.js";
import { buildAutorizacionEnvelope } from "./envelopes/autorizacion.js";
import { parseRecepcion } from "./parsers/recepcion.js";
import { parseAutorizacion } from "./parsers/autorizacion.js";
import { postXml } from "./http.js";
import { env } from "../env.js";
import crypto from "node:crypto";

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const urls = (ambiente: "1" | "2") =>
  ambiente === "2"
    ? { rec: env.SRI_RECEPCION_URL_PRODUCCION, aut: env.SRI_AUTORIZACION_URL_PRODUCCION }
    : { rec: env.SRI_RECEPCION_URL_PRUEBAS, aut: env.SRI_AUTORIZACION_URL_PRUEBAS };

export const sendRecepcion = async (
  signedXml: Buffer,
  ambiente: "1" | "2",
): Promise<RecepcionResult> => {
  const env = buildRecepcionEnvelope(signedXml.toString("base64"));
  const r = await postXml(urls(ambiente).rec, env);
  const parsed = parseRecepcion(r.body);
  return {
    ...parsed,
    durationMs: r.durationMs,
    httpStatus: r.status,
    rawXmlSha256: sha256(r.body),
  };
};

export const consultarAutorizacion = async (
  claveAcceso: string,
  ambiente: "1" | "2",
): Promise<AutorizacionResult> => {
  const env = buildAutorizacionEnvelope(claveAcceso);
  const r = await postXml(urls(ambiente).aut, env);
  const parsed = parseAutorizacion(r.body);
  return { ...parsed, durationMs: r.durationMs, httpStatus: r.status };
};
```

## 7. Implementation guide

### 7.1 Steps

1. Implement files per §6.
2. Add `undici` (or `axios`) dep if not using global `fetch`.
3. Tests with fixtures (no network):
   - Recepción RECIBIDA → returns `estado: "RECIBIDA"`.
   - Recepción DEVUELTA with two error messages → mensajes parsed in order.
   - Autorización AUTORIZADO with embedded `<comprobante>` CDATA → `authorizedXml` is populated.
   - Autorización EN PROCESO → `estado: "EN_PROCESO"`.
   - Retry: fake transport that returns 502 twice then 200 → final result OK (with 2 retries observed).
   - Retry: timeout → 4 retries then throws.
4. Add a "smoke" script `apps/sri-core/scripts/smoke-sri.ts` that targets the test SRI environment with a known-bad clave to verify connectivity (manual, not CI).

### 7.2 Dependencies (apps/sri-core)

| Package          | Version   | Purpose                                                     |
| ---------------- | --------- | ----------------------------------------------------------- |
| `undici`         | `^6.19.8` | HTTP. (Or use built-in `fetch` if Node 22 native suffices.) |
| `@xmldom/xmldom` | (already) | DOM parser.                                                 |
| `xpath`          | (already) | XPath selectors.                                            |

### 7.3 Conventions

- All envelopes hand-rolled (no SOAP libraries) — the format is tiny and stable.
- Never log raw SOAP body. `sha256` is logged for correlation, never the body.
- The two top-level functions are pure (apart from network); deps injected via the `agent` and env.

## 8. Acceptance criteria

- **AC-1.** Given fixture `recepcion.RECIBIDA.xml`, `parseRecepcion` returns `{ estado: "RECIBIDA", mensajes: [] }`.
- **AC-2.** Given fixture `recepcion.DEVUELTA.errores.xml`, `parseRecepcion` returns `estado: "DEVUELTA"` and all error messages with `tipo === "ERROR"`.
- **AC-3.** Given fixture `autorizacion.AUTORIZADO.xml`, `parseAutorizacion` returns `estado: "AUTORIZADO"`, `numeroAutorizacion`, `fechaAutorizacion`, and `authorizedXml` containing the embedded `<factura>...`.
- **AC-4.** Retry on 502 happens up to 4 times with exponential backoff (timing assertions allow tolerance).
- **AC-5.** Retry **does not** happen on a 200 response with `DEVUELTA` body — that's a business outcome, not a transient error.
- **AC-6.** A 30 s timeout aborts a hung response and counts as one attempt.
- **AC-7.** No log line in the test run contains `<xml>` or `<comprobante>`.

## 9. Test plan

- Unit tests for parsers using committed fixtures.
- Unit tests for `postXml` using a local `nock` (or custom dispatcher) to simulate 502/timeouts.
- Property test: build envelopes never produce malformed XML (round-trip parse).

## 10. Security considerations

- TLS 1.2+ enforced. Production must reject downgraded SRI URLs (none expected, but defensive).
- Never log SOAP bodies (PII and signed material).
- Verify HTTPS hostname matches expected SRI domain — Node default does this; do not disable.

## 11. Observability

- Per call: log `service=sri-core`, `operacion=recepcion|autorizacion`, `ambiente`, `httpStatus`, `durationMs`, `estado`, `claveAcceso`.
- Metric (future): `sri_request_duration_seconds`, labels `(operacion, ambiente, estado)`.

## 12. Risks and mitigations

| Risk                               | Mitigation                                                      |
| ---------------------------------- | --------------------------------------------------------------- |
| SRI changes namespace/prefixes     | Parsers use `local-name()` XPath; survives most prefix changes. |
| Long-running call ties up workers  | Per-attempt timeout 30 s + bounded retries.                     |
| Memory exhaustion from giant CDATA | 5 MB response cap; log + abort beyond.                          |
| Outbound IP not whitelisted by SRI | Configurable proxy via `HTTPS_PROXY` env (built into undici).   |

## 13. Open questions

- Use `soap` (npm) library for the SOAP layer? No — it auto-pretty-prints, drifts namespaces, and obscures debugging. Hand-rolled envelopes are simpler and safer.

## 14. Change log

| Date       | Change         | By                       |
| ---------- | -------------- | ------------------------ |
| 2026-05-19 | Initial draft. | Project owner via Claude |
