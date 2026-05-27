/**
 * `BlobStore` — interface + filesystem implementation for the SRI
 * lifecycle's persistent artefacts.
 *
 * Source of truth:
 *   - SPEC-0026 §4 FR-4 + §6.6 (interface + filesystem dev impl).
 *   - PLAN-0026 §4 Phase 1.
 *   - TASKS-0026 §1.1.
 *   - ai/context/security.md §Logging + §Certificate handling (never log
 *     blob bytes; treat the FS root as PII storage; 0600 perms).
 *
 * Design notes:
 *
 *   - The interface lives here, NOT in `lifecycle/`. The lifecycle slice
 *     still re-exports it as a back-compat shim so `sign-step.ts` works
 *     without touching the existing import path.
 *   - The filesystem implementation is the dev/test default. Production
 *     swaps in an S3 / GCS / Azure-Blob implementation behind the same
 *     interface (SPEC-0026 §6.6).
 *   - Tenants share the filesystem root, but every key MUST start with a
 *     `<companyId>/` segment so a directory listing surfaces who owns
 *     each blob. The lifecycle layer derives the key — never user input.
 *   - We reject any key containing `..`, an absolute path, a control
 *     character, or a NUL byte. The signed and authorized XML files are
 *     opened with `0600` mode where the platform supports it (POSIX);
 *     Windows ignores the mode bit but the underlying NTFS ACL still
 *     defaults to the process user. PROMPT-0026 §6 + security.md.
 *   - Each blob written via `put` is paired with a `.sha256` sibling
 *     file containing the hex digest of the bytes. This gives the
 *     polling / audit layer a way to verify integrity without re-reading
 *     the (potentially large) XML body.
 *   - We never log the bytes; we only log `{ key, bytes, sha256 }`. The
 *     redactor still strips `signedXml` / `authorizedXml` by path as
 *     defence in depth.
 *
 * Concurrency:
 *
 *   - `put` writes to a temp file in the same directory and then renames
 *     into place. Rename is atomic on POSIX, so a concurrent reader sees
 *     either the old bytes or the new bytes, never a torn write. Two
 *     `put` calls for the same key race for the rename; last writer
 *     wins, and the loser's bytes are unreachable (the temp file is
 *     unlinked on a failed rename). The lifecycle never issues
 *     concurrent puts for the same key because the orchestrator owns
 *     the key derivation.
 */
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/* -------------------------------------------------------------------------- */
/*                                  Interface                                 */
/* -------------------------------------------------------------------------- */

export interface BlobStorePutResult {
  /** The stored key (echoed back so the caller can persist it). */
  readonly key: string;
  /** Byte size of the stored payload — handy for log lines. */
  readonly bytes: number;
  /** SHA-256 hex digest of the bytes. */
  readonly sha256: string;
}

/**
 * The contract every BlobStore (in-memory, filesystem, S3, …) honours.
 *
 * Implementations MUST:
 *   - Be safe to call concurrently from multiple workers within the
 *     same process. Cross-process safety is delegated to the backing
 *     store (FS rename, S3 conditional puts).
 *   - Reject keys with path-traversal segments or absolute paths.
 *   - Never log the payload bytes — only `{ key, bytes }`.
 */
export interface BlobStore {
  /**
   * Persist `data` under `key`. Implementations are idempotent: the same
   * `key` + `data` pair must always succeed. Re-putting a different
   * payload under the same key is allowed (last writer wins); callers
   * that want strict immutability MUST mint a fresh key per write.
   *
   * Throws `BlobStoreKeyError` if the key fails validation.
   */
  put(key: string, data: Buffer | string): Promise<BlobStorePutResult>;
  /**
   * Read back a previously-stored blob. Returns `null` when not found —
   * callers decide whether that's an error. Implementations MUST decode
   * to UTF-8 string (XML payload). Binary payloads aren't part of the
   * SRI lifecycle today.
   */
  get(key: string): Promise<string | null>;
  /** Remove a blob. No-op when the key doesn't exist. */
  remove(key: string): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*                                  Errors                                    */
/* -------------------------------------------------------------------------- */

/**
 * Thrown when a key fails validation. We surface a stable `code` so
 * route handlers can map it to a 422; the message is safe to log.
 */
export class BlobStoreKeyError extends Error {
  public readonly code = "blob_store.invalid_key";

  public constructor(message: string) {
    super(message);
    this.name = "BlobStoreKeyError";
  }
}

/* -------------------------------------------------------------------------- */
/*                            Key validation                                  */
/* -------------------------------------------------------------------------- */

/**
 * Validate a blob key. Rules:
 *
 *   - Non-empty, not bare whitespace.
 *   - No leading `/` or `\` (refuse absolute paths).
 *   - No drive-letter prefix (`C:`).
 *   - No `..` segment anywhere.
 *   - No NUL byte or ASCII control character (< 0x20).
 *   - Only safe characters: alnum, `-`, `_`, `.`, `/`, ` ` is rejected
 *     because forward slash is the only segment separator we accept.
 *
 * The lifecycle layer derives keys from `companyId` + `claveAcceso` +
 * a constant suffix; both inputs are ULIDs/digit strings, so this
 * predicate is a defence-in-depth net rather than the primary gate.
 */
export function assertSafeKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new BlobStoreKeyError("key must be a non-empty string");
  }
  if (key.length > 512) {
    throw new BlobStoreKeyError("key exceeds 512-character limit");
  }
  if (key.startsWith("/") || key.startsWith("\\")) {
    throw new BlobStoreKeyError("key must not be an absolute path");
  }
  if (/^[A-Za-z]:[\\/]/u.test(key)) {
    throw new BlobStoreKeyError("key must not contain a drive-letter prefix");
  }
  const segments = key.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      throw new BlobStoreKeyError("key contains a parent-directory segment ('..')");
    }
    if (seg.length === 0) {
      // Empty segment from `//`, leading `/`, or trailing `/`.
      throw new BlobStoreKeyError("key contains an empty path segment");
    }
  }
  for (let i = 0; i < key.length; i += 1) {
    const c = key.charCodeAt(i);
    if (c === 0 || c < 0x20) {
      throw new BlobStoreKeyError("key contains a control character or NUL byte");
    }
  }
  // Permit only [A-Za-z0-9._/-] — same alphabet used by clave-acceso +
  // ULID, plus the segment separator and the file-extension dot.
  if (!/^[A-Za-z0-9._/-]+$/u.test(key)) {
    throw new BlobStoreKeyError("key contains characters outside [A-Za-z0-9._/-]");
  }
}

/* -------------------------------------------------------------------------- */
/*                           In-memory BlobStore                              */
/* -------------------------------------------------------------------------- */

/**
 * In-memory `BlobStore` for tests + the interim sign-step. Per-process;
 * cleared by `clear()` (used by the test harness).
 */
export class InMemoryBlobStore implements BlobStore {
  private readonly map = new Map<string, string>();

  // NB: the `async` keyword on these synchronous-bodied methods is load-
  // bearing: callers `.catch()` on the returned Promise expecting that the
  // safe-key check rejects rather than throws synchronously (see
  // blob-store.test.ts "rejects path-traversal keys"). Removing `async`
  // would turn the throw into a synchronous error that escapes the Promise
  // chain and breaks the test contract.
  // eslint-disable-next-line @typescript-eslint/require-await
  public async put(key: string, data: Buffer | string): Promise<BlobStorePutResult> {
    assertSafeKey(key);
    const text = typeof data === "string" ? data : data.toString("utf8");
    this.map.set(key, text);
    const bytes = Buffer.byteLength(text, "utf8");
    const sha256 = createHash("sha256").update(text, "utf8").digest("hex");
    return { key, bytes, sha256 };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async get(key: string): Promise<string | null> {
    assertSafeKey(key);
    return this.map.get(key) ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async remove(key: string): Promise<void> {
    assertSafeKey(key);
    this.map.delete(key);
  }

  public clear(): void {
    this.map.clear();
  }

  public size(): number {
    return this.map.size;
  }
}

/* -------------------------------------------------------------------------- */
/*                         Filesystem BlobStore                               */
/* -------------------------------------------------------------------------- */

export interface FilesystemBlobStoreOptions {
  /**
   * Root directory under which all blobs live. Defaults to `./.blobs`
   * relative to `process.cwd()`. The directory is `.gitignore`d.
   *
   * The constructor never reads `process.env`; the caller (server.ts)
   * forwards the configured value.
   */
  readonly root: string;
  /**
   * POSIX file mode for blob files. Defaults to `0o600` (owner read/write
   * only). Windows ignores this value; the underlying NTFS ACL is
   * derived from the process user.
   */
  readonly fileMode?: number;
  /**
   * POSIX directory mode. Defaults to `0o700`.
   */
  readonly dirMode?: number;
}

/**
 * Filesystem implementation of {@link BlobStore}. Persists XML payloads
 * (signed + authorized) under `<root>/<companyId>/<documentId>/<name>`.
 *
 * Side-files:
 *   - `<file>.sha256` — hex digest, written alongside the payload.
 *
 * Atomicity: each put writes to `<file>.tmp.<rand>` first, then renames
 * into place. The temp file lives in the same directory so rename never
 * crosses a filesystem boundary.
 */
export class FilesystemBlobStore implements BlobStore {
  private readonly root: string;
  private readonly fileMode: number;
  private readonly dirMode: number;

  public constructor(options: FilesystemBlobStoreOptions) {
    this.root = path.resolve(options.root);
    this.fileMode = options.fileMode ?? 0o600;
    this.dirMode = options.dirMode ?? 0o700;
  }

  /**
   * Root directory under which all blobs live. Exposed for logs/tests.
   */
  public getRoot(): string {
    return this.root;
  }

  /**
   * Resolve a sanitised key to an absolute path under the root.
   * Throws if the resolved path escapes the root — second line of
   * defence on top of `assertSafeKey`.
   */
  private resolvePath(key: string): string {
    assertSafeKey(key);
    const resolved = path.resolve(this.root, key);
    const relative = path.relative(this.root, resolved);
    if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new BlobStoreKeyError("resolved path escaped the BlobStore root");
    }
    return resolved;
  }

  public async put(key: string, data: Buffer | string): Promise<BlobStorePutResult> {
    const absolute = this.resolvePath(key);
    const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    // Ensure the containing directory exists with restrictive mode.
    await fs.mkdir(path.dirname(absolute), {
      recursive: true,
      mode: this.dirMode,
    });

    // Atomic write: temp file in the same dir then rename. The temp name
    // includes 8 random bytes so two concurrent puts don't collide.
    const tmp = `${absolute}.tmp.${randomBytes(8).toString("hex")}`;
    try {
      await fs.writeFile(tmp, buffer, { mode: this.fileMode });
      await fs.rename(tmp, absolute);
    } catch (err) {
      // Best-effort cleanup. We deliberately don't await an unlink that
      // could itself throw; the temp file is already orphaned.
      try {
        await fs.unlink(tmp);
      } catch {
        // ignore
      }
      throw err;
    }

    // Sidecar checksum: same restrictive mode. We write it AFTER the
    // payload rename so a partial state never has a checksum without the
    // body. Loss of the checksum (process crash between writes) is
    // recoverable: the body is the source of truth.
    const checksumPath = `${absolute}.sha256`;
    await fs.writeFile(checksumPath, `${sha256}\n`, { mode: this.fileMode });

    return { key, bytes: buffer.byteLength, sha256 };
  }

  public async get(key: string): Promise<string | null> {
    const absolute = this.resolvePath(key);
    try {
      const buffer = await fs.readFile(absolute);
      return buffer.toString("utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  public async remove(key: string): Promise<void> {
    const absolute = this.resolvePath(key);
    const checksum = `${absolute}.sha256`;
    // Remove both; ignore ENOENT.
    for (const p of [absolute, checksum]) {
      try {
        await fs.unlink(p);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err;
        }
      }
    }
  }

  /**
   * Read the sidecar checksum. Returns `null` when missing. Exposed for
   * tests + future integrity-verification tooling.
   */
  public async getChecksum(key: string): Promise<string | null> {
    const absolute = this.resolvePath(key);
    try {
      const text = await fs.readFile(`${absolute}.sha256`, "utf8");
      return text.trim();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                            Blob key helpers                                */
/* -------------------------------------------------------------------------- */

/**
 * Canonical key for the signed XML produced by the sign step.
 *
 * Layout: `<companyId>/<documentId>/signed.xml`.
 *
 * The (companyId, documentId) tuple gives a unique, tenant-scoped
 * directory per SriDocument. `documentId` is a ULID minted by sri-core,
 * so it never depends on user input.
 */
export function signedXmlKey(companyId: string, documentId: string): string {
  return `${companyId}/${documentId}/signed.xml`;
}

/**
 * Canonical key for the authorized XML produced by the autorización
 * step. Lives in the same per-document directory as the signed payload.
 */
export function authorizedXmlKey(companyId: string, documentId: string): string {
  return `${companyId}/${documentId}/authorized.xml`;
}
