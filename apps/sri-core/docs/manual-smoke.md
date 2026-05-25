# SRI SOAP — manual smoke test

How to exercise the `RecepcionClient` and `AutorizacionClient` against the
SRI **pruebas** environment from a developer workstation. The smoke is
NOT part of CI — it depends on a real test certificate and a routable
network path to `celcer.sri.gob.ec`.

> Hard rules — keep them in your head before you run anything:
>
> 1. Never run the smoke against the **producción** endpoints unless an
>    operator approved it. The production URLs are gated behind the
>    `ambiente: "2"` switch — confirm twice.
> 2. The signed XML the script will produce contains your test customer's
>    PII. Do not paste the body anywhere. The script never prints it.
> 3. The smoke is read-mostly: recepción is idempotent (mensaje 43 covers
>    re-sends), and autorización is a pure query.

## 0. Prereqs

- A `.p12` certificate for the test taxpayer issued by Banco Central or
  Security Data. Place it under `apps/sri-core/test/fixtures/<your-name>.p12`
  (the directory is gitignored).
- The certificate passphrase in `SRI_CERT_TEST_PASSPHRASE` (export inline;
  do NOT add it to `.env`).
- `SRI_STUB_MODE=false` in your local `.env` so the real pipeline runs.
- `SRI_RECEPCION_URL_PRUEBAS` + `SRI_AUTORIZACION_URL_PRUEBAS` already
  configured by the repo's `.env.example`.

## 1. Boot the stack

```bash
# In one terminal — postgres + the api / sri-core containers.
pnpm dev:up

# Wait for the services to become healthy:
pnpm dev:health
```

## 2. Mint an api session + service JWT

```bash
# Login (this returns a session cookie). The seed user is
# `admin@dev.local` / `dev-password`.
curl -i \
  -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@dev.local","password":"dev-password"}'

# Then call /v1/documents/emit with a fixture body — the api mints a
# service JWT and forwards to sri-core internally. The web app does the
# same flow.
curl -i \
  -X POST http://localhost:3000/v1/documents/emit \
  -b cookies.txt \
  -H 'content-type: application/json' \
  --data-binary @apps/api/test/fixtures/factura-emit.json
```

## 3. Optional — run the SOAP clients from a Node REPL

For deeper debugging of just the SOAP layer, start a REPL inside the
`sri-core` workspace and use the clients directly. This bypasses the
api → sri-core JWT gate.

```bash
cd apps/sri-core
pnpm exec node --experimental-strip-types <<'NODE'
import { RecepcionClient, AutorizacionClient } from "./src/soap/index.ts";

const baseEnv = {
  SRI_RECEPCION_URL_PRUEBAS: process.env.SRI_RECEPCION_URL_PRUEBAS,
  SRI_RECEPCION_URL_PRODUCCION: process.env.SRI_RECEPCION_URL_PRODUCCION,
  SRI_AUTORIZACION_URL_PRUEBAS: process.env.SRI_AUTORIZACION_URL_PRUEBAS,
  SRI_AUTORIZACION_URL_PRODUCCION: process.env.SRI_AUTORIZACION_URL_PRODUCCION,
  SRI_HTTP_TIMEOUT_MS: 30_000,
};

// Replace with the bytes of a real signed XML produced by SPEC-0024.
import { readFileSync } from "node:fs";
const signedXml = readFileSync("./test/fixtures/signed-known-good.xml");

const rec = new RecepcionClient({ env: baseEnv });
const aut = new AutorizacionClient({ env: baseEnv });

const recResult = await rec.send({ signedXml, ambiente: "1" });
console.log({ estado: recResult.estado, mensajes: recResult.mensajes.map(m => m.identificador) });

if (recResult.estado === "RECIBIDA") {
  const clave = recResult.claveAcceso;
  if (clave === undefined) throw new Error("RECIBIDA without claveAcceso?");
  // Wait a moment — SRI authorisation often lags receipt by seconds.
  await new Promise(r => setTimeout(r, 3_000));
  const autResult = await aut.query({ claveAcceso: clave, ambiente: "1" });
  console.log({ estado: autResult.estado, ambiente: autResult.ambiente, numero: autResult.numeroAutorizacion });
}
NODE
```

## 4. Interpreting the results

| Result          | Meaning                                                                             | Next step                                             |
| --------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `RECIBIDA`      | SRI accepted the XML; authorisation pending.                                        | Poll `AutorizacionClient.query(...)` every 2-5 s.     |
| `DEVUELTA`      | SRI rejected the XML (validation/business). See `mensajes[]`.                       | Fix the XML/data; never resend the same bytes.        |
| `AUTORIZADO`    | Comprobante is fully authorised. `numeroAutorizacion` is your printable identifier. | Persist `autorizadoXml` via the BlobStore.            |
| `EN_PROCESO`    | SRI hasn't decided yet. Wait + re-query.                                            | Keep polling with the orchestrator's backoff.         |
| `NO_AUTORIZADO` | Final rejection by SRI. Check `mensajes[]`.                                         | Surface to the user; rebuild + re-emit if applicable. |

## 5. Failure modes you may observe

- **`ETIMEDOUT` / `UND_ERR_HEADERS_TIMEOUT`** — SRI is under load. The
  retry wrapper covers this; if you see the budget-exceeded error
  (`SriRetryBudgetExceededError`), retry the smoke later.
- **TLS handshake failure** — usually a misconfigured proxy or stale CA
  bundle on the workstation. The clients reject anything below TLS 1.2.
- **HTTP 401** from the api — the cookie expired. Re-run step 2.

## 6. Cleanup

```bash
pnpm dev:down
unset SRI_CERT_TEST_PASSPHRASE
rm -f cookies.txt
```

> **Reminder.** None of the smoke commands above produce a log line that
> contains the signed XML or the autorised XML. If you ever see one of
> those bodies in stdout/stderr while developing, you've hit a redaction
> gap — report it immediately, do NOT commit, and add the leaking path
> to `packages/logger/src/redactions.ts`.
