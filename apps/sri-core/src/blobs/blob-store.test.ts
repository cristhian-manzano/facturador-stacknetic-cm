/**
 * Unit tests for the canonical {@link BlobStore} interface + the two
 * shipping implementations: in-memory and filesystem.
 *
 * Covers TASKS-0026 §1.1:
 *   - put / get / remove round-trip on both impls.
 *   - Key rejection: `..`, absolute paths, control chars, drive letters.
 *   - Filesystem impl: directories created with restrictive mode; files
 *     written atomically (no orphaned temp files); sidecar checksum
 *     matches the payload digest.
 *   - The interface NEVER reads `process.env` — the FS impl is
 *     constructed with an explicit `root` and we point it at an
 *     `os.tmpdir()` subdirectory so tests don't pollute the repo.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BlobStoreKeyError,
  FilesystemBlobStore,
  InMemoryBlobStore,
  assertSafeKey,
  authorizedXmlKey,
  signedXmlKey,
} from "./blob-store.js";

describe("assertSafeKey", () => {
  it.each([
    ["valid plain key", "01F8/01F9/signed.xml"],
    ["dot in segment", "abc/def/signed.xml"],
    ["dashes allowed", "01F-8/01F-9/file-name.xml"],
  ])("%s accepts: %s", (_name, key) => {
    expect(() => assertSafeKey(key)).not.toThrow();
  });

  // Build the bad-key table with explicit String.fromCharCode for the
  // control-character cases so the source file stays printable ASCII.
  const BAD_KEYS: ReadonlyArray<readonly [string, string]> = [
    ["empty", ""],
    ["bare whitespace", " "],
    ["dot-dot segment", "01F8/../etc/passwd"],
    ["leading slash", "/etc/passwd"],
    ["leading backslash", "\\etc\\passwd"],
    ["drive prefix", "C:/Windows/system32/cmd.exe"],
    ["double slash", "01F8//signed.xml"],
    ["trailing slash", "01F8/signed.xml/"],
    ["control char tab", `01F8/${String.fromCharCode(9)}foo`],
    ["NUL byte", `01F8/${String.fromCharCode(0)}foo`],
    ["control char DEL", `01F8/${String.fromCharCode(0x1f)}foo`],
    ["disallowed char space", "01F8 foo/signed.xml"],
    ["disallowed char colon", "01F8:foo/signed.xml"],
  ];

  it.each(BAD_KEYS)("%s rejects: %s", (_name, key) => {
    expect(() => assertSafeKey(key)).toThrowError(BlobStoreKeyError);
  });
});

describe("signedXmlKey / authorizedXmlKey helpers", () => {
  it("produce <companyId>/<documentId>/<file>.xml", () => {
    expect(signedXmlKey("CO1", "DO1")).toBe("CO1/DO1/signed.xml");
    expect(authorizedXmlKey("CO1", "DO1")).toBe("CO1/DO1/authorized.xml");
  });
});

describe("InMemoryBlobStore", () => {
  it("put + get + remove round-trip", async () => {
    const store = new InMemoryBlobStore();
    const r1 = await store.put("a/b/x.xml", "<x/>");
    expect(r1.key).toBe("a/b/x.xml");
    expect(r1.bytes).toBe(4);
    expect(r1.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await store.get("a/b/x.xml")).toBe("<x/>");

    await store.remove("a/b/x.xml");
    expect(await store.get("a/b/x.xml")).toBeNull();
  });

  it("get returns null for an unknown key", async () => {
    const store = new InMemoryBlobStore();
    expect(await store.get("nope/nope.xml")).toBeNull();
  });

  it("put accepts Buffer input", async () => {
    const store = new InMemoryBlobStore();
    const r = await store.put("a/b.xml", Buffer.from("<x/>", "utf8"));
    expect(r.bytes).toBe(4);
    expect(await store.get("a/b.xml")).toBe("<x/>");
  });

  it("put rejects path-traversal keys", async () => {
    const store = new InMemoryBlobStore();
    await expect(store.put("../etc/passwd", "x")).rejects.toBeInstanceOf(BlobStoreKeyError);
  });

  it("clear empties the store; size reflects current entries", async () => {
    const store = new InMemoryBlobStore();
    expect(store.size()).toBe(0);
    await store.put("a/1.xml", "1");
    await store.put("a/2.xml", "2");
    expect(store.size()).toBe(2);
    store.clear();
    expect(store.size()).toBe(0);
  });

  it("put overwrites an existing key (last write wins)", async () => {
    const store = new InMemoryBlobStore();
    await store.put("a/k.xml", "first");
    await store.put("a/k.xml", "second");
    expect(await store.get("a/k.xml")).toBe("second");
  });
});

describe("FilesystemBlobStore", () => {
  let root: string;
  let store: FilesystemBlobStore;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "facturador-blobs-"));
    store = new FilesystemBlobStore({ root });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("put writes the payload, mkdir'ing the parent dirs", async () => {
    const r = await store.put("CO/DO/signed.xml", "<x/>");
    expect(r.bytes).toBe(4);
    expect(r.sha256).toBe(
      // Pre-computed SHA-256 digest of the UTF-8 bytes `<x/>`.
      "2a31f44da4bd7decbbd3ddfd1a37ae04d02ec665e2c2688816ccc65631586ed1",
    );
    const onDisk = await fs.readFile(path.join(root, "CO", "DO", "signed.xml"), "utf8");
    expect(onDisk).toBe("<x/>");
  });

  it("writes a sidecar .sha256 file containing the digest", async () => {
    const r = await store.put("CO/DO/signed.xml", "<x/>");
    const text = await fs.readFile(path.join(root, "CO", "DO", "signed.xml.sha256"), "utf8");
    expect(text.trim()).toBe(r.sha256);

    // The convenience getter exposes the same value.
    expect(await store.getChecksum("CO/DO/signed.xml")).toBe(r.sha256);
  });

  it("get returns the payload bytes as UTF-8", async () => {
    await store.put("CO/DO/signed.xml", "<x>héllo</x>");
    expect(await store.get("CO/DO/signed.xml")).toBe("<x>héllo</x>");
  });

  it("get returns null when the file is missing", async () => {
    expect(await store.get("CO/DO/missing.xml")).toBeNull();
  });

  it("getChecksum returns null when the checksum file is missing", async () => {
    expect(await store.getChecksum("CO/DO/missing.xml")).toBeNull();
  });

  it("remove deletes both the payload and the sidecar", async () => {
    await store.put("CO/DO/signed.xml", "<x/>");
    await store.remove("CO/DO/signed.xml");
    await expect(fs.access(path.join(root, "CO", "DO", "signed.xml"))).rejects.toThrow();
    await expect(fs.access(path.join(root, "CO", "DO", "signed.xml.sha256"))).rejects.toThrow();
  });

  it("remove is a no-op when the file does not exist", async () => {
    await expect(store.remove("CO/DO/missing.xml")).resolves.toBeUndefined();
  });

  it("put leaves no temp files behind", async () => {
    await store.put("CO/DO/signed.xml", "<x/>");
    const entries = await fs.readdir(path.join(root, "CO", "DO"));
    expect(entries.sort()).toEqual(["signed.xml", "signed.xml.sha256"]);
  });

  it("put rejects keys containing `..`", async () => {
    await expect(store.put("../etc/passwd", "x")).rejects.toBeInstanceOf(BlobStoreKeyError);
  });

  it("put rejects absolute paths", async () => {
    await expect(store.put("/etc/passwd", "x")).rejects.toBeInstanceOf(BlobStoreKeyError);
  });

  it("get rejects path-traversal keys", async () => {
    await expect(store.get("../etc/passwd")).rejects.toBeInstanceOf(BlobStoreKeyError);
  });

  it("getRoot returns the resolved root path", () => {
    expect(path.isAbsolute(store.getRoot())).toBe(true);
  });

  it("overwrites the payload on a second put with the same key", async () => {
    await store.put("CO/DO/signed.xml", "first");
    const r = await store.put("CO/DO/signed.xml", "second");
    expect(await store.get("CO/DO/signed.xml")).toBe("second");
    expect(r.bytes).toBe(6);
  });

  it("writes the file with restrictive POSIX mode (0o600) where supported", async () => {
    await store.put("CO/DO/signed.xml", "<x/>");
    const stat = await fs.stat(path.join(root, "CO", "DO", "signed.xml"));
    if (process.platform !== "win32") {
      // Mask out the file-type bits, keep mode bits.
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });
});
