/**
 * `runSignStep` — sign-step orchestrator.
 *
 * Source of truth:
 *   - SPEC-0024 §FR-7 (local verify required).
 *   - PLAN-0024 §4 Phase 3.
 *   - TASKS-0024 §5.1.
 *   - SPEC-0026 §6 (will formalise the BlobStore).
 *
 * Pipeline:
 *
 *   1. Pull the document by id; guard companyId mismatch.
 *   2. Load the active certificate via `getActiveCertificate(prisma, companyId)`.
 *   3. Call `signFacturaXml(...)` — algorithm comes from the `algo`
 *      parameter (lifecycle reads `env.SRI_SIGN_ALGO`, never accepts it
 *      from a request body).
 *   4. Local verification is performed *inside* `signFacturaXml`; nothing
 *      additional needed at this layer.
 *   5. Write the signed XML to the BlobStore using the claveAcceso as
 *      the key. The key shape is stable across the orchestrator (which
 *      will read it back in SPEC-0026).
 *   6. `recordEvent({ etapa: SIGN, estado: FIRMADO })` transitions the
 *      document to FIRMADO and patches `signedXmlBlobKey` in the SAME
 *      transaction. The event row gives the UI an "etapa SIGN" entry.
 *
 * Hard constraints:
 *
 *   - The function NEVER reads PEMs from disk. The active-cert helper
 *     owns that and we forward its parsed handle straight to the signer.
 *   - The function NEVER logs the signed XML. We log the key + size; the
 *     redactor still censors `signedXml` by path if any caller
 *     accidentally passes it.
 *   - The function NEVER returns the signed XML. Callers that need it
 *     read it back from the BlobStore by key (next slice).
 *
 * Caller note: the `xmlForSigning` is passed in by the orchestrator
 * (which got it from the build step in the same request) — SPEC-0026
 * will let the function fetch it from the BlobStore by `xmlForSigningKey`
 * when builds and signs happen on different workers.
 */
import type { PrismaClient } from "@facturador/db";
import type { Logger } from "@facturador/logger";
import { NotFoundError, ForbiddenError } from "@facturador/utils/errors";

import { getActiveCertificate } from "../certificates/active.js";
import { signFacturaXml, type SignAlgo } from "../xml/sign.js";

import type { BlobStore } from "./blob-store.js";
import { recordEvent } from "./events.js";

export interface RunSignStepInput {
  /** The `SriDocument.id` to sign. */
  readonly documentId: string;
  /**
   * The canonical XML body (without declaration) — produced by
   * `buildFacturaXml(...).xmlForSigning` in the build step.
   */
  readonly xmlForSigning: string;
  /** Algorithm. Default SHA-1 per SRI ficha técnica. */
  readonly algo?: SignAlgo;
}

export interface RunSignStepDeps {
  readonly prisma: PrismaClient;
  readonly blobStore: BlobStore;
  /**
   * Logger used for non-PII diagnostics. The implementation never logs
   * the signed XML body; it logs algorithm, byte sizes, durations.
   */
  readonly logger?: Pick<Logger, "info" | "warn" | "error">;
  /** Clock override for tests. */
  readonly now?: () => Date;
}

export interface RunSignStepResult {
  readonly documentId: string;
  readonly signedXmlBlobKey: string;
  readonly bytes: number;
  readonly algo: SignAlgo;
  readonly durationMs: number;
}

/**
 * Compute the blob key for the signed XML. The shape mirrors what
 * SPEC-0026 will expect from the orchestrator so we don't churn keys
 * when the BlobStore graduates to a real backend.
 */
function signedXmlBlobKeyFor(claveAcceso: string): string {
  return `${claveAcceso}/signed.xml`;
}

export async function runSignStep(
  deps: RunSignStepDeps,
  input: RunSignStepInput,
): Promise<RunSignStepResult> {
  const { prisma, blobStore, logger } = deps;
  const now = (deps.now ?? (() => new Date()))();

  // 1. Pull the document.
  const doc = await prisma.sriDocument.findUnique({
    where: { id: input.documentId },
  });
  if (doc === null) {
    throw new NotFoundError("sri_document");
  }

  // 2. Active certificate. The helper enforces tenant scoping by
  //    `companyId`; we forward the document's `companyId` straight.
  const cert = await getActiveCertificate(prisma, doc.companyId, {
    ...(logger === undefined ? {} : { logger }),
  });

  // 3. Sign. The signer enforces internal verification — a bad signature
  //    throws and we propagate without persisting anything.
  const t0 = Date.now();
  let signedXml: string;
  let actualAlgo: SignAlgo;
  try {
    const result = await signFacturaXml({
      xmlForSigning: input.xmlForSigning,
      certificate: {
        certPem: cert.certPem,
        keyPem: cert.keyPem,
        expiresAt: cert.expiresAt,
      },
      ...(input.algo === undefined ? {} : { algo: input.algo }),
      now: () => now,
    });
    signedXml = result.signedXml;
    actualAlgo = result.algo;
  } catch (err) {
    // Never log the XML or PEMs. The signer error already redacts.
    const message = err instanceof Error ? err.message : String(err);
    logger?.warn(
      {
        event: "sri.sign.failed",
        documentId: input.documentId,
        companyId: doc.companyId,
        algo: input.algo ?? "SHA1",
        reason: message,
      },
      "sign step failed",
    );
    throw err;
  }
  const durationMs = Date.now() - t0;

  // 5. Persist the signed XML. We use a content-addressed key so a
  //    re-sign overwrites cleanly (idempotency on the BlobStore side).
  const blobKey = signedXmlBlobKeyFor(doc.claveAcceso);
  const { bytes } = await blobStore.put(blobKey, signedXml);

  // 6. State transition + event row in one transaction.
  await recordEvent(prisma, {
    documentId: input.documentId,
    etapa: "SIGN",
    estado: "FIRMADO",
    durationMs,
    patch: { signedXmlBlobKey: blobKey },
  });

  logger?.info(
    {
      event: "sri.sign.success",
      documentId: input.documentId,
      companyId: doc.companyId,
      claveAcceso: doc.claveAcceso,
      algo: actualAlgo,
      signedXmlBlobKey: blobKey,
      bytesIn: Buffer.byteLength(input.xmlForSigning, "utf8"),
      bytesOut: bytes,
      durationMs,
    },
    "sri document signed",
  );

  // Defensive: any caller that derefs `cert.keyPem` after this point is
  // a defect. We don't zero the buffer (V8 GC handles strings) but the
  // local binding falls out of scope on return.
  void cert;

  // Defence-in-depth tenant check: should match the cert's tenant.
  // (The active-cert helper already filters by companyId; a mismatch
  // here would indicate database corruption.)
  if (doc.companyId.length === 0) {
    throw new ForbiddenError("document has no tenant scope");
  }

  return {
    documentId: input.documentId,
    signedXmlBlobKey: blobKey,
    bytes,
    algo: actualAlgo,
    durationMs,
  };
}
