/**
 * `/v1/certificates/*` routes — certificate lifecycle for SRI Core.
 *
 * Source of truth:
 *   - SPEC-0021 §6 (upload, activate, list, delete).
 *   - PLAN-0021 §4 Phase 3.
 *   - TASKS-0021 §3–§5 + §8 + §9.
 *
 * Surface:
 *   - POST   /v1/certificates              multipart upload (.p12 + passphrase + alias)
 *   - GET    /v1/certificates              list metadata for the caller's tenant
 *   - GET    /v1/certificates/:id          metadata for one cert
 *   - POST   /v1/certificates/:id/activate atomic activate
 *   - DELETE /v1/certificates/:id          delete (INACTIVE only)
 *
 * Security policy:
 *   - Every route is gated by `requireServiceJwt` (mounted in `server.ts`).
 *   - The JWT `sub` is the only trustworthy companyId — every query filters
 *     on it.
 *   - Response bodies NEVER include `p12CiphertextB64`, `p12NonceB64`,
 *     `p12TagB64`, `passphrase*`, or any PEM material. We serialise a
 *     hand-built `CertificateMetadata` shape from a small whitelist.
 *   - Audit rows are written for every mutating action.
 */
import { Router, type Request, type Response } from "express";
import multer, { type Multer } from "multer";
import { z } from "zod";
import { ulid } from "ulid";
import type { Certificate, PrismaClient } from "@facturador/db";
import { newId } from "@facturador/db";
import type { Logger } from "@facturador/logger";
import {
  audit as auditFn,
  type AuditDependencies,
  type AuditPrismaClient,
} from "@facturador/utils/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "@facturador/utils/errors";
import { encryptP12 } from "../crypto/envelope.js";
import {
  BadPassphraseError,
  CannotDeleteActiveError,
  DuplicateFingerprintError,
  ExpiredCertificateError,
  ParseError,
} from "../certificates/errors.js";
import { parseP12 } from "../certificates/parser.js";
import { clearActiveCertificateCache } from "../certificates/active.js";

/** Maximum multipart payload — TASKS-0021 §3.1. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB

const UploadCertificateBodySchema = z.object({
  alias: z.string().min(1).max(120),
});

const IdParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

export interface CertificateMetadata {
  readonly id: string;
  readonly alias: string;
  readonly subjectCN: string;
  readonly issuerCN: string;
  readonly serialNumber: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly fingerprintSha256: string;
  readonly status: string;
  readonly kmsKeyVersion: string;
  readonly uploadedAt: string;
}

/**
 * Hand-built mapper from a Prisma row to the wire shape. The function is
 * the SOLE place that decides what leaves sri-core. Any new column added
 * to `Certificate` is invisible to callers unless explicitly listed here.
 */
export function toCertificateMetadata(row: Certificate): CertificateMetadata {
  return {
    id: row.id,
    alias: row.alias,
    subjectCN: row.subjectCN,
    issuerCN: row.issuerCN,
    serialNumber: row.serialNumber,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo.toISOString(),
    fingerprintSha256: row.fingerprintSha256,
    status: row.status,
    kmsKeyVersion: row.kmsKeyVersion,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

export interface BuildCertificatesRouterDeps {
  readonly prisma: PrismaClient;
  readonly logger: Logger;
  /** Override the multer builder. Tests use the default. */
  readonly uploader?: Multer;
}

function defaultUploader(): Multer {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter(_req, file, cb) {
      // .p12 archives are conventionally application/x-pkcs12 or
      // application/octet-stream. We accept either + .p12 / .pfx
      // filename suffixes so curl uploads without explicit mimetype work.
      const mimeOk =
        file.mimetype === "application/x-pkcs12" ||
        file.mimetype === "application/octet-stream" ||
        file.mimetype === "application/pkcs12";
      const nameOk = /\.(p12|pfx)$/i.test(file.originalname);
      if (mimeOk || nameOk) {
        cb(null, true);
        return;
      }
      cb(new ValidationError("Unsupported certificate file type"));
    },
  });
}

interface AuditEvent {
  readonly action: string;
  readonly entityId?: string;
  readonly companyId: string;
  readonly payloadJson?: Record<string, unknown>;
}

// PrismaClient is structurally wider than AuditPrismaClient (`payloadJson`
// is `unknown` in the helper vs. Prisma's strict JSON union). The cast is
// safe because the helper only writes through the `create` slice with the
// shape AuditPrismaClient declares; the same pattern is used in
// `apps/api/src/auth/handlers.ts`.
const auditAdapter = (prisma: PrismaClient): AuditPrismaClient =>
  prisma as unknown as AuditPrismaClient;

function buildAuditWrite(
  prisma: PrismaClient,
  logger: Logger,
): (event: AuditEvent) => Promise<void> {
  const deps: AuditDependencies = { prisma: auditAdapter(prisma), logger };
  return async (event) =>
    auditFn(deps, {
      action: event.action,
      entity: "Certificate",
      companyId: event.companyId,
      ...(event.entityId === undefined ? {} : { entityId: event.entityId }),
      ...(event.payloadJson === undefined ? {} : { payloadJson: event.payloadJson }),
    });
}

export function buildCertificatesRouter(deps: BuildCertificatesRouterDeps): Router {
  const router = Router();
  const { prisma, logger } = deps;
  const uploader = deps.uploader ?? defaultUploader();
  const audit = buildAuditWrite(prisma, logger);

  // --- POST /v1/certificates --------------------------------------------------
  router.post(
    "/",
    // The multer middleware reads the multipart body. The passphrase is
    // expected on a header (`x-cert-passphrase`) so it doesn't sit as a
    // multipart text field — multipart fields end up echoed verbatim by
    // some intermediate proxies. A header is the smallest blast radius
    // for a one-shot value and stays out of the multer-parsed
    // `req.body.alias` text field.
    uploader.single("file"),
    async (req: Request, res: Response) => {
      const callerCompanyId = req.service?.companyId;
      if (callerCompanyId === undefined) {
        throw new ForbiddenError("Service token missing");
      }
      // 1) Validate alias text field.
      const aliasParse = UploadCertificateBodySchema.safeParse(req.body);
      if (!aliasParse.success) {
        throw new ValidationError("Invalid upload body", {
          errors: [
            {
              identificador: "alias",
              mensaje: "alias is required (1..120 chars)",
              tipo: "ERROR",
            },
          ],
        });
      }

      // 2) Validate file presence.
      const file = req.file;
      if (file?.buffer === undefined || file.size === 0) {
        throw new ValidationError("Missing certificate file", {
          errors: [
            {
              identificador: "file",
              mensaje: "multipart field `file` is required",
              tipo: "ERROR",
            },
          ],
        });
      }

      // 3) Read the one-shot passphrase header. We do NOT log it (the
      // logger redacts the path) and we never persist its plaintext
      // outside the encrypted envelope.
      const passphraseHeader = req.header("x-cert-passphrase");
      if (passphraseHeader === undefined || passphraseHeader.length === 0) {
        throw new ValidationError("Missing passphrase header", {
          errors: [
            {
              identificador: "passphrase",
              mensaje: "X-Cert-Passphrase header is required to unlock the .p12 archive",
              tipo: "ERROR",
            },
          ],
        });
      }

      // 4) Parse the .p12 — throws domain errors mapped by errorHandler.
      let parsed;
      try {
        parsed = parseP12(file.buffer, passphraseHeader);
      } catch (err) {
        if (
          err instanceof BadPassphraseError ||
          err instanceof ExpiredCertificateError ||
          err instanceof ParseError
        ) {
          req.log?.warn(
            {
              event: "certificate.upload.reject",
              companyId: callerCompanyId,
              code: err.code,
            },
            "certificate upload rejected",
          );
          throw err;
        }
        throw new ParseError("unexpected parse failure");
      }

      // 5) Fingerprint dup check (global — fingerprint is a tenant-
      // independent hash of the cert bytes). We rely on the unique index
      // on `fingerprintSha256` to race-protect the insert.
      const existing = await prisma.certificate.findUnique({
        where: { fingerprintSha256: parsed.fingerprintSha256 },
      });
      if (existing !== null) {
        throw new DuplicateFingerprintError();
      }

      // 6) Encrypt the .p12 bytes + the passphrase. Two distinct envelopes
      // with two random nonces under the same master key.
      const p12Env = encryptP12(file.buffer);
      const passEnv = encryptP12(Buffer.from(passphraseHeader, "utf8"));

      // 7) Persist. The row starts INACTIVE — operators activate explicitly.
      let created: Certificate;
      try {
        created = await prisma.certificate.create({
          data: {
            id: newId(),
            companyId: callerCompanyId,
            alias: aliasParse.data.alias,
            subjectCN: parsed.subjectCN,
            issuerCN: parsed.issuerCN,
            serialNumber: parsed.serialHex,
            validFrom: parsed.validFrom,
            validTo: parsed.validTo,
            p12CiphertextB64: p12Env.ciphertext.toString("base64"),
            p12NonceB64: p12Env.nonce.toString("base64"),
            p12TagB64: p12Env.tag.toString("base64"),
            passphraseCiphertextB64: passEnv.ciphertext.toString("base64"),
            passphraseNonceB64: passEnv.nonce.toString("base64"),
            passphraseTagB64: passEnv.tag.toString("base64"),
            kmsKeyVersion: "v1",
            fingerprintSha256: parsed.fingerprintSha256,
            status: "INACTIVE",
          },
        });
      } catch (err) {
        if (isPrismaUniqueViolation(err)) {
          throw new DuplicateFingerprintError();
        }
        throw err;
      }

      await audit({
        action: "cert.uploaded",
        entityId: created.id,
        companyId: callerCompanyId,
        payloadJson: {
          fingerprintSha256: created.fingerprintSha256,
          validTo: created.validTo.toISOString(),
          subjectCN: created.subjectCN,
        },
      });

      res.status(201).json(toCertificateMetadata(created));
    },
  );

  // --- GET /v1/certificates -------------------------------------------------
  router.get("/", async (req: Request, res: Response) => {
    const callerCompanyId = req.service?.companyId;
    if (callerCompanyId === undefined) {
      throw new ForbiddenError("Service token missing");
    }
    const rows = await prisma.certificate.findMany({
      where: { companyId: callerCompanyId, deletedAt: null },
      orderBy: { uploadedAt: "desc" },
    });
    res.json({ items: rows.map(toCertificateMetadata) });
  });

  // --- GET /v1/certificates/:id ---------------------------------------------
  router.get("/:id", async (req: Request, res: Response) => {
    const callerCompanyId = req.service?.companyId;
    if (callerCompanyId === undefined) {
      throw new ForbiddenError("Service token missing");
    }
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) {
      throw new NotFoundError("certificate");
    }
    const row = await prisma.certificate.findFirst({
      where: { id: params.data.id, companyId: callerCompanyId, deletedAt: null },
    });
    if (row === null) {
      // Use 404 rather than 403 to avoid existence disclosure (SPEC-0021
      // §9 negative path).
      throw new NotFoundError("certificate");
    }
    res.json(toCertificateMetadata(row));
  });

  // --- POST /v1/certificates/:id/activate -----------------------------------
  router.post("/:id/activate", async (req: Request, res: Response) => {
    const callerCompanyId = req.service?.companyId;
    if (callerCompanyId === undefined) {
      throw new ForbiddenError("Service token missing");
    }
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) {
      throw new NotFoundError("certificate");
    }
    const id = params.data.id;

    // Single transaction: deactivate the others and activate this one.
    // Use $transaction with a callback so all writes commit or none do.
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.certificate.findFirst({
        where: { id, companyId: callerCompanyId, deletedAt: null },
      });
      if (target === null) {
        return { activated: null, deactivatedIds: [] as string[] };
      }
      const previouslyActive = await tx.certificate.findMany({
        where: {
          companyId: callerCompanyId,
          status: "ACTIVE",
          deletedAt: null,
          NOT: { id },
        },
        select: { id: true },
      });
      if (previouslyActive.length > 0) {
        await tx.certificate.updateMany({
          where: {
            companyId: callerCompanyId,
            status: "ACTIVE",
            deletedAt: null,
            NOT: { id },
          },
          data: { status: "INACTIVE" },
        });
      }
      const updated = await tx.certificate.update({
        where: { id },
        data: { status: "ACTIVE" },
      });
      return {
        activated: updated,
        deactivatedIds: previouslyActive.map((p) => p.id),
      };
    });

    if (result.activated === null) {
      throw new NotFoundError("certificate");
    }

    // Invalidate the in-memory cache for this tenant. Done OUTSIDE the
    // transaction so a rollback doesn't leave a phantom invalidation —
    // a transient eviction is harmless (next call reloads), a missed
    // invalidation is dangerous (stale cert served).
    clearActiveCertificateCache(callerCompanyId);

    await audit({
      action: "cert.activated",
      entityId: result.activated.id,
      companyId: callerCompanyId,
      payloadJson: {
        fingerprintSha256: result.activated.fingerprintSha256,
      },
    });
    for (const deactivatedId of result.deactivatedIds) {
      await audit({
        action: "cert.deactivated",
        entityId: deactivatedId,
        companyId: callerCompanyId,
      });
    }

    res.json(toCertificateMetadata(result.activated));
  });

  // --- DELETE /v1/certificates/:id -----------------------------------------
  router.delete("/:id", async (req: Request, res: Response) => {
    const callerCompanyId = req.service?.companyId;
    if (callerCompanyId === undefined) {
      throw new ForbiddenError("Service token missing");
    }
    const params = IdParamsSchema.safeParse(req.params);
    if (!params.success) {
      throw new NotFoundError("certificate");
    }
    const id = params.data.id;
    const row = await prisma.certificate.findFirst({
      where: { id, companyId: callerCompanyId, deletedAt: null },
    });
    if (row === null) {
      throw new NotFoundError("certificate");
    }
    if (row.status === "ACTIVE") {
      throw new CannotDeleteActiveError();
    }
    // Soft-delete by setting deletedAt; ciphertext is retained for
    // forensics until a hard-purge job (out of scope).
    await prisma.certificate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await audit({
      action: "cert.deleted",
      entityId: id,
      companyId: callerCompanyId,
    });
    res.status(204).end();
  });

  return router;
}

// -- Multer error wrapper --------------------------------------------------
/**
 * Translate multer's `LIMIT_FILE_SIZE` into a 413 ProblemDetail. Mounted
 * AFTER the certificates router in `server.ts` so it can intercept the
 * error before the generic handler.
 */
import type { NextFunction } from "express";
export function multerErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // multer.MulterError is exported as a named export; narrow by checking
  // the `code` property to avoid the runtime dependency on its constructor.
  if (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  ) {
    const code = (err as { code: string }).code;
    if (code === "LIMIT_FILE_SIZE") {
      const requestId = (_req as Request & { id?: string }).id;
      res.status(413).json({
        title: "Payload too large",
        status: 413,
        code: "certificate.too_large",
        type: "urn:facturador:error:certificate.too_large",
        detail: `Max upload size is ${MAX_UPLOAD_BYTES} bytes.`,
        ...(typeof requestId === "string" && requestId.length > 0 ? { instance: requestId } : {}),
      });
      return;
    }
  }
  next(err);
}

function isPrismaUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code === "P2002";
}

// Suppress an unused-symbol diagnostic when `ulid` is referenced for type
// completeness only.
void ulid;
