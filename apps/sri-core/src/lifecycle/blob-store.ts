/**
 * Compatibility re-export for the BlobStore abstraction.
 *
 * The authoritative interface and implementations live in
 * `apps/sri-core/src/blobs/blob-store.ts` (SPEC-0026 §6.6). This file is
 * a back-compat shim used by the sign-step (`sign-step.ts`) and the
 * existing tests — both imported from `lifecycle/blob-store.js` before
 * the SPEC-0026 directory split landed.
 *
 * New code should import from `../blobs/blob-store.js` directly.
 */
export {
  InMemoryBlobStore,
  FilesystemBlobStore,
  BlobStoreKeyError,
  assertSafeKey,
  signedXmlKey,
  authorizedXmlKey,
} from "../blobs/blob-store.js";
export type {
  BlobStore,
  BlobStorePutResult,
  FilesystemBlobStoreOptions,
} from "../blobs/blob-store.js";
