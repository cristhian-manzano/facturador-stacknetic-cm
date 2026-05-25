/**
 * One-time wiring of Node's WebCrypto + DOM glue into the xadesjs stack.
 *
 * Source of truth:
 *   - SPEC-0024 §6.3 (engine init).
 *   - PLAN-0024 §3 (xadesjs + xmldsigjs + @xmldom/xmldom + xpath + xml-core).
 *   - TASKS-0024 §1.2 ("Wire Node webcrypto into xadesjs at module load").
 *
 * Why a setup module instead of inline init?
 *
 *   - xadesjs uses a process-wide engine (set via `Application.setEngine`).
 *     Calling it more than once is harmless but produces nondeterministic
 *     test ordering if multiple modules race for the singleton.
 *   - `xml-core@1.2` requires `setNodeDependencies({ DOMParser,
 *     XMLSerializer, DOMImplementation, xpath })` before any reference is
 *     dereferenced; without it, `Sign()` throws a cryptic "Cannot resolve
 *     node dependency" deep inside the canonicaliser.
 *   - The init is idempotent: a guard flag prevents redundant calls so
 *     the LRU certificate cache and the signer module don't fight over
 *     engine state.
 *
 * Security note:
 *   - This module touches the global xadesjs engine — it does **not**
 *     touch any private key or certificate. The actual signing operations
 *     happen in `sign.ts`; nothing here is logged.
 *   - We import from `node:crypto` (not the `crypto` global) so the Node
 *     22 webcrypto is the source of truth; ESM imports in the workspace
 *     do not accidentally pick up a polyfill.
 */
import { webcrypto } from "node:crypto";
import { DOMParser, XMLSerializer, DOMImplementation } from "@xmldom/xmldom";
import * as xpath from "xpath";
import { Application, setNodeDependencies } from "xadesjs";

/**
 * Guard flag — set to `true` after a successful initialisation. Module
 * load order across vitest workers can re-trigger this; we want the
 * cheapest possible no-op on the hot path.
 */
let initialised = false;

/**
 * Hook for tests that need to verify the idempotency behaviour without
 * spawning a subprocess. Not exported from the package barrel.
 */
export function __resetWebcryptoSetupForTests(): void {
  initialised = false;
}

/**
 * Idempotent one-shot init for xadesjs + xml-core. Safe to call from any
 * module that uses `SignedXml`; the first call wires everything, every
 * subsequent call returns immediately.
 *
 * Throws if the host environment is missing `webcrypto.subtle` — that
 * indicates a sub-Node-18 runtime, which the SRI-core service refuses to
 * boot under (per `engines.node` in package.json).
 */
export function ensureXadesEngine(): void {
  if (initialised) return;

  // Confirm the SubtleCrypto surface area exists. Node 22 always has it,
  // but a custom polyfill might not — fail loudly here rather than during
  // a verification call.
  /* c8 ignore next 5 -- the `engines.node` field pins ≥18, so Node always
     exposes `crypto.webcrypto.subtle`. The branch exists for defence in
     depth against a bundler swapping in a polyfill that omits Subtle. */
  if (typeof webcrypto.subtle === "undefined") {
    throw new Error(
      "ensureXadesEngine: SubtleCrypto unavailable; require Node ≥ 18 (process supplies `crypto.webcrypto`)",
    );
  }

  // xml-core needs explicit DOM + xpath bindings in Node. The default
  // export of `@xmldom/xmldom` provides Document/Element constructors;
  // we pass them by name as the docs require.
  setNodeDependencies({
    DOMParser,
    XMLSerializer,
    DOMImplementation,
    xpath,
  });

  // Register the engine under a stable name so a verifier that runs
  // before the signer in the same process picks up the same Crypto.
  Application.setEngine("NodeJS", webcrypto as unknown as Crypto);

  initialised = true;
}
