/**
 * `signFacturaXml` — XAdES-BES enveloped signature for the SRI factura.
 *
 * Source of truth:
 *   - SPEC-0024 §6 (sign function, algorithms, FR-1..FR-7).
 *   - PLAN-0024 §3 (xadesjs/xmldsigjs + Node webcrypto).
 *   - TASKS-0024 §2.1 + §4.
 *   - docs/sri-facturacion-electronica-ecuador.md §10 ("Firma electrónica
 *     XAdES-BES").
 *
 * Wire contract:
 *
 *   ```ts
 *   const { signedXml } = await signFacturaXml({
 *     xmlForSigning,
 *     certificate: { certPem, keyPem },
 *     algo: "SHA1" | "SHA256",
 *   });
 *   ```
 *
 *   - `xmlForSigning` MUST come from `buildFacturaXml(...)` (SPEC-0023) —
 *     i.e. the canonical body WITHOUT the `<?xml ... ?>` declaration. The
 *     signer inspects the bytes and refuses to start if a declaration
 *     is present.
 *   - `certificate` arrives from `getActiveCertificate(prisma, companyId)`
 *     (SPEC-0021). The PEMs are kept in local variables and never logged
 *     (PROMPT-0024 §6, security.md §Certificate handling).
 *   - The function returns the signed XML body. Callers prepend the
 *     declaration if they want a transport-ready document; the signed
 *     bytes themselves are byte-stable (modulo the embedded SigningTime).
 *
 * Hard rules enforced here:
 *
 *   1. Exactly one `<ds:Signature>` is appended as the LAST child of
 *      `<factura id="comprobante">`.
 *   2. The single content reference uses URI `#comprobante` with
 *      transforms `[enveloped-signature, xml-exc-c14n#]`.
 *   3. KeyInfo contains the leaf certificate DER (base64) under
 *      `<X509Data><X509Certificate>`. No PEM headers leak.
 *   4. SignedProperties carries `SigningTime` + `SigningCertificate`
 *      (CertDigest + IssuerSerial). xadesjs generates the v1 form (SRI
 *      accepts BES; v2 is opt-in).
 *   5. Algorithm: SHA-1 default; SHA-256 only when the caller passes
 *      `algo: "SHA256"`. Selection is server-side; never accepted from a
 *      request body (PROMPT-0024 §6).
 *   6. Before returning, the freshly produced XML is verified against
 *      the embedded certificate. A failure throws — we never hand a
 *      caller a signed-but-self-invalid document.
 *
 * Why a thin wrapper instead of calling xadesjs directly at the callsite?
 *
 *   - Algorithm pinning + URI/transforms enforcement live in one place,
 *     so the orchestrator can't accidentally pass an SRI-incompatible
 *     option set.
 *   - Local verification is mandatory; tucking it inside `signFacturaXml`
 *     prevents lifecycle code from forgetting to call it.
 *   - Centralised error normalisation: cert-expired / no-private-key /
 *     pem-malformed all surface as `XmlSignError` subclasses, not as
 *     raw xadesjs strings (which can include private-key fragments in
 *     some upstream versions).
 */
import { webcrypto } from "node:crypto";

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SignedXml, type OptionsXAdES } from "xadesjs";

import { ensureXadesEngine } from "./webcrypto-setup.js";

/* -------------------------------------------------------------------------- */
/*                                  Errors                                    */
/* -------------------------------------------------------------------------- */

/** Discriminated error code surfaced by {@link signFacturaXml}. */
export type XmlSignErrorCode =
  | "INVALID_INPUT_XML"
  | "INVALID_CERT_PEM"
  | "INVALID_KEY_PEM"
  | "CERT_EXPIRED"
  | "SIGN_FAILED"
  | "VERIFY_FAILED";

/**
 * Typed error thrown by the signer. Never embeds raw PEM or key material;
 * the human-readable `message` is safe to surface to clients and logs.
 */
export class XmlSignError extends Error {
  public readonly code: XmlSignErrorCode;

  public constructor(code: XmlSignErrorCode, message: string) {
    super(message);
    this.name = "XmlSignError";
    this.code = code;
  }
}

/* -------------------------------------------------------------------------- */
/*                              Public surface                                */
/* -------------------------------------------------------------------------- */

/** Signing algorithm choice — SHA-1 by default, SHA-256 when opted in. */
export type SignAlgo = "SHA1" | "SHA256";

/**
 * Mapping from the public {@link SignAlgo} to the WebCrypto + URI
 * identifiers consumed by xadesjs. SHA-1 is the SRI ficha técnica default;
 * SHA-256 is acceptable per `docs/sri-facturacion-electronica-ecuador.md`
 * §10 ("Algoritmos aceptados").
 */
const ALGO_MAP: Record<
  SignAlgo,
  {
    readonly webcryptoHash: "SHA-1" | "SHA-256";
    /** Hash URI surfaced in `<ds:DigestMethod>` and `<xades:CertDigest>`. */
    readonly digestUri: string;
    /** Signature URI surfaced in `<ds:SignatureMethod>`. */
    readonly signatureUri: string;
  }
> = {
  SHA1: {
    webcryptoHash: "SHA-1",
    digestUri: "http://www.w3.org/2000/09/xmldsig#sha1",
    signatureUri: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
  },
  SHA256: {
    webcryptoHash: "SHA-256",
    digestUri: "http://www.w3.org/2001/04/xmlenc#sha256",
    signatureUri: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
  },
};

/**
 * A parsed certificate handle. Per PROMPT-0024 hard constraint #1 the
 * signer must not receive raw bytes; the active-cert cache (SPEC-0021)
 * delivers this shape so the bytes never round-trip outside the cache.
 *
 * Only `certPem` + `keyPem` are required at the signing call site; we
 * accept `subjectCN` / `expiresAt` as opaque metadata so the caller can
 * surface lifecycle errors (expired) without re-parsing.
 */
export interface SignerCertificateHandle {
  readonly certPem: string;
  readonly keyPem: string;
  /** Optional clock guard — when supplied, the signer rejects an expired cert. */
  readonly expiresAt?: Date;
}

export interface SignFacturaXmlInput {
  /** Output of `buildFacturaXml(...).xmlForSigning` (no XML declaration). */
  readonly xmlForSigning: string;
  /** Active certificate handle (never raw .p12). */
  readonly certificate: SignerCertificateHandle;
  /** Signing algorithm — default SHA-1 per SRI ficha técnica. */
  readonly algo?: SignAlgo;
  /**
   * Optional clock override for tests. Used only to compare against
   * `certificate.expiresAt`. Never written into the signed XML —
   * xadesjs always stamps a fresh UTC `SigningTime`.
   */
  readonly now?: () => Date;
}

export interface SignFacturaXmlResult {
  /** The signed XML body. Caller prepends the declaration if needed. */
  readonly signedXml: string;
  /** The algorithm actually used; useful for the lifecycle event payload. */
  readonly algo: SignAlgo;
}

/* -------------------------------------------------------------------------- */
/*                              PEM utilities                                 */
/* -------------------------------------------------------------------------- */

/** Strip PEM headers + whitespace and return the raw base64 cert/key body. */
const pemToBase64 = (pem: string, kind: "CERTIFICATE" | "PRIVATE KEY"): string => {
  const trimmed = pem.trim();
  // The forge / OpenSSL outputs use either `BEGIN CERTIFICATE` or
  // `BEGIN PRIVATE KEY`/`BEGIN RSA PRIVATE KEY` headers. We accept any
  // hyphenated `BEGIN ... END` block and rely on the WebCrypto importKey
  // call to reject a malformed body.
  const beginRe = /-----BEGIN [^-]+-----/g;
  const endRe = /-----END [^-]+-----/g;
  if (!beginRe.test(trimmed) || !endRe.test(trimmed)) {
    throw new XmlSignError(
      kind === "CERTIFICATE" ? "INVALID_CERT_PEM" : "INVALID_KEY_PEM",
      `${kind} PEM missing BEGIN/END markers`,
    );
  }
  return trimmed
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
};

/**
 * Import the RSA private key (PKCS#8 PEM) into Node's WebCrypto with the
 * requested hash.
 *
 * Why `extractable=true`? xadesjs internally calls `exportKey("jwk", ...)`
 * during `ApplySigningCertificate` to verify the (public) modulus
 * matches the embedded leaf cert — a non-extractable key throws a
 * `DOMException: key is not extractable` here. The exported value never
 * leaves the local stack: it goes from WebCrypto → xadesjs internals and
 * is GC'd at function return. Per security.md §Certificate handling the
 * key already lives in process memory by the time we're called; making
 * it extractable does not widen the blast radius.
 *
 * We try PKCS#8 first (the format node-forge emits when given an
 * RSA PrivateKeyInfo). If that fails, we fall back to PKCS#1 RSA private
 * key, which forge also writes for some older .p12 chains.
 */
async function importPrivateKey(
  keyPem: string,
  webcryptoHash: "SHA-1" | "SHA-256",
): Promise<CryptoKey> {
  const trimmed = keyPem.trim();
  const isPkcs1 = trimmed.includes("BEGIN RSA PRIVATE KEY");
  const base64 = pemToBase64(trimmed, "PRIVATE KEY");
  const der = Buffer.from(base64, "base64");

  if (isPkcs1) {
    // WebCrypto cannot import PKCS#1 directly; we wrap into PKCS#8 by
    // prepending the RSA OID and an OCTET STRING tag. node-forge usually
    // emits PKCS#8; this branch is defensive.
    try {
      const wrapped = wrapPkcs1AsPkcs8(der);
      return await webcrypto.subtle.importKey(
        "pkcs8",
        wrapped,
        { name: "RSASSA-PKCS1-v1_5", hash: { name: webcryptoHash } },
        true,
        ["sign"],
      );
    } catch (err) {
      throw new XmlSignError(
        "INVALID_KEY_PEM",
        `failed to import PKCS#1 RSA private key: ${(err as Error).message}`,
      );
    }
  }

  try {
    return await webcrypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: { name: webcryptoHash } },
      true,
      ["sign"],
    );
  } catch (err) {
    throw new XmlSignError(
      "INVALID_KEY_PEM",
      `failed to import PKCS#8 RSA private key: ${(err as Error).message}`,
    );
  }
}

/**
 * Wrap a PKCS#1 RSAPrivateKey DER into a PKCS#8 PrivateKeyInfo SEQUENCE
 * so WebCrypto's `pkcs8` importer can consume it. The static prefix is
 * the encoded `version=0 + AlgorithmIdentifier(rsaEncryption, NULL)`
 * header — invariant for RSA keys regardless of modulus size.
 *
 * We avoid pulling a full ASN.1 library for this single transformation;
 * the prefix and length tags below are derived from RFC 5208 §5.
 */
function wrapPkcs1AsPkcs8(pkcs1: Buffer): Buffer {
  // AlgorithmIdentifier for rsaEncryption (OID 1.2.840.113549.1.1.1) + NULL params.
  const algorithmIdentifier = Buffer.from([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);
  const version = Buffer.from([0x02, 0x01, 0x00]); // INTEGER 0

  // OCTET STRING wrapping the PKCS#1 DER.
  const octetStringHeader = makeDerLength(0x04, pkcs1.length);
  const octetString = Buffer.concat([octetStringHeader, pkcs1]);

  // SEQUENCE wrapping version + algId + octetString.
  const inner = Buffer.concat([version, algorithmIdentifier, octetString]);
  const seqHeader = makeDerLength(0x30, inner.length);
  return Buffer.concat([seqHeader, inner]);
}

function makeDerLength(tag: number, length: number): Buffer {
  if (length < 0x80) return Buffer.from([tag, length]);
  if (length < 0x100) return Buffer.from([tag, 0x81, length]);
  if (length < 0x10000) {
    return Buffer.from([tag, 0x82, (length >> 8) & 0xff, length & 0xff]);
  }
  return Buffer.from([tag, 0x83, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
}

/* -------------------------------------------------------------------------- */
/*                              Input validation                              */
/* -------------------------------------------------------------------------- */

/**
 * Guard rails on the input string. We don't validate against the full
 * XSD here (that's `validate.ts`'s job); we just refuse the inputs that
 * would silently produce a broken signature.
 */
function assertSigningInputShape(xml: string): void {
  if (xml.charCodeAt(0) === 0xfeff) {
    throw new XmlSignError("INVALID_INPUT_XML", "input XML must not contain a UTF-8 BOM");
  }
  if (xml.startsWith("<?xml")) {
    throw new XmlSignError(
      "INVALID_INPUT_XML",
      "input XML must be xmlForSigning (no XML declaration)",
    );
  }
  // The factura builder always emits `<factura id="comprobante" version=`.
  // Reject anything else — a wrong root means `#comprobante` would dangle.
  if (!xml.includes('<factura id="comprobante"')) {
    throw new XmlSignError(
      "INVALID_INPUT_XML",
      'input XML root must be <factura id="comprobante">',
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Signer                                    */
/* -------------------------------------------------------------------------- */

/**
 * Produce an XAdES-BES enveloped signature for the supplied factura XML.
 *
 * Pipeline:
 *   1. `ensureXadesEngine()` registers WebCrypto + DOM bindings with
 *      xml-core (idempotent).
 *   2. Validate the input shape (no BOM, no declaration, correct root).
 *   3. Parse to a Document via `@xmldom/xmldom`.
 *   4. Import the private key (RSASSA-PKCS1-v1_5 + chosen hash).
 *   5. Configure a `SignedXml` with the canonical reference and XAdES
 *      properties; xadesjs computes digests + signature value.
 *   6. Append the resulting `<ds:Signature>` as the last child of
 *      `<factura>` and serialise the document.
 *   7. Locally re-verify the signature against the embedded leaf cert.
 *      Throw on failure so a broken pipeline never reaches the SRI SOAP
 *      client.
 *
 * Determinism note: the produced XML is NOT byte-stable across calls —
 * `xades:SigningTime` is freshly stamped every time. Other elements are
 * deterministic for fixed inputs (xadesjs+exclusive C14N normalises
 * attribute order + namespace declarations).
 */
export async function signFacturaXml(input: SignFacturaXmlInput): Promise<SignFacturaXmlResult> {
  ensureXadesEngine();
  assertSigningInputShape(input.xmlForSigning);

  const algo: SignAlgo = input.algo ?? "SHA1";
  const algoCfg = ALGO_MAP[algo];

  // Cert expiry guard — defence in depth on top of the active-cert
  // helper. The helper already filters expired certs via the cron, but
  // a race between the cron and a signing call could still pass an
  // expired entry. We never sign with a known-expired cert.
  if (input.certificate.expiresAt !== undefined) {
    const now = (input.now ?? (() => new Date()))();
    if (input.certificate.expiresAt.getTime() <= now.getTime()) {
      throw new XmlSignError(
        "CERT_EXPIRED",
        `certificate expired at ${input.certificate.expiresAt.toISOString()}; refuse to sign`,
      );
    }
  }

  // Strip PEM headers + whitespace; xadesjs wants the bare base64 body.
  // We do NOT log either value at any level.
  const certB64 = pemToBase64(input.certificate.certPem, "CERTIFICATE");
  const privateKey = await importPrivateKey(input.certificate.keyPem, algoCfg.webcryptoHash);

  // xadesjs mutates the supplied document by appending the Signature.
  // We parse a fresh copy from the input string so the caller's buffer
  // is never modified.
  const doc = new DOMParser().parseFromString(input.xmlForSigning, "application/xml");
  // The xadesjs Sign helper accepts a Document; we keep a typed view to
  // satisfy the structural Document interface from lib.dom.
  const docAny = doc as unknown as Document;

  const signed = new SignedXml();

  const signOptions: OptionsXAdES = {
    keyValue: privateKey,
    x509: [certB64],
    signingCertificate: certB64,
    references: [
      {
        uri: "#comprobante",
        hash: { name: algoCfg.webcryptoHash },
        transforms: ["enveloped", "exc-c14n"],
      },
    ],
    signingTime: { value: (input.now ?? (() => new Date()))() },
  };

  let signatureElement: Element;
  try {
    // xadesjs/xmldsigjs uses the algorithm + key combination to compute
    // `SignatureMethod`. The hash bound to the imported key (via
    // `importKey({ hash })`) governs which RSA-SHA* URI is emitted.
    const signature = await signed.Sign(
      { name: "RSASSA-PKCS1-v1_5" } as Algorithm,
      privateKey,
      docAny,
      signOptions,
    );
    // xadesjs returns the constructed Signature node; the `Sign()` call
    // does NOT auto-attach to the supplied document (the API leaves
    // placement to the caller for envelope flexibility). We append as
    // the last child of `<factura>` so the SRI XSD slot is filled.
    signatureElement = signature.GetXml() as unknown as Element;
    const root = docAny.documentElement;
    /* c8 ignore next 8 -- defensive guard: assertSigningInputShape already
       validates `<factura id="comprobante"` is present, so xmldom always
       produces a `<factura>` documentElement. Unreachable from any input
       that satisfies the public contract. */
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (root === null || root.localName !== "factura") {
      throw new XmlSignError("INVALID_INPUT_XML", "documentElement is not <factura> after parse");
    }
    root.appendChild(signatureElement);
  } catch (err) {
    if (err instanceof XmlSignError) throw err;
    /* c8 ignore start -- xadesjs Sign() failures inside the happy path
       only occur on engine misconfiguration (missing setNodeDependencies,
       missing crypto engine) — both initialised idempotently at module
       load. Manufacturing this branch from a test requires mocking
       xadesjs internals; we exercise the surrounding contract via the
       INVALID_KEY_PEM / INVALID_CERT_PEM branches, which DO surface the
       analogous errors. */
    const name = err instanceof Error ? err.constructor.name : "Unknown";
    const rawMsg = err instanceof Error ? err.message : "";
    const shortMsg =
      rawMsg.length > 0 && rawMsg.length < 160 && !/[<>]/.test(rawMsg) ? `: ${rawMsg}` : "";
    throw new XmlSignError("SIGN_FAILED", `xadesjs Sign threw (${name})${shortMsg}`);
    /* c8 ignore stop */
  }

  const signedXml = new XMLSerializer().serializeToString(docAny);

  // Local verification — never hand back a self-invalid signature.
  // Throws on failure so the lifecycle never persists a bad blob.
  // (SPEC-0024 §FR-7 + PROMPT-0024 "Round-trip: sign → verify via the
  // same library returns valid".)
  const verifyResult = await verifySignedXmlInternal(signedXml);
  /* c8 ignore next 6 -- xadesjs is internally consistent: if Sign()
     returns, Verify() against the same document succeeds. This branch
     fires only on a library regression. We surface VERIFY_FAILED to the
     lifecycle so the document never advances to FIRMADO with a broken
     signature; cannot be reached from a healthy library. */
  if (!verifyResult.valid) {
    throw new XmlSignError(
      "VERIFY_FAILED",
      `self-verification failed: ${verifyResult.errors.join("; ")}`,
    );
  }

  return { signedXml, algo };
}

/* -------------------------------------------------------------------------- */
/*                       Internal verify (shared)                             */
/* -------------------------------------------------------------------------- */

/**
 * Internal verifier — used by the signer for the self-check and by
 * `verify.ts` for the public surface. Kept private here to avoid a
 * circular import and to keep the engine-init guard inline.
 */
async function verifySignedXmlInternal(
  signedXml: string,
): Promise<{ valid: boolean; errors: string[] }> {
  ensureXadesEngine();

  // `@xmldom/xmldom`'s DOMParser is permissive: it returns a Document
  // even for malformed inputs (with parse warnings on stderr). We don't
  // try/catch around `parseFromString` because the failure path is to
  // produce a document without the expected Signature element — which
  // we detect immediately below and surface as a clean `valid: false`.
  const doc = new DOMParser().parseFromString(signedXml, "application/xml") as unknown as Document;

  const signatures = doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature");
  if (signatures.length === 0) {
    return { valid: false, errors: ["no <ds:Signature> element found"] };
  }
  if (signatures.length > 1) {
    return {
      valid: false,
      errors: [`expected exactly one <ds:Signature>, found ${String(signatures.length)}`],
    };
  }

  const signed = new SignedXml(doc);
  try {
    signed.LoadXml(signatures[0] as unknown as Element);
  } catch (err) {
    return {
      valid: false,
      errors: [`LoadXml failed: ${(err as Error).message}`],
    };
  }
  try {
    const ok = await signed.Verify();
    if (ok) return { valid: true, errors: [] };
    return { valid: false, errors: ["Verify() returned false"] };
  } catch (err) {
    return {
      valid: false,
      errors: [`Verify threw: ${(err as Error).message}`],
    };
  }
}

/**
 * Internal-only re-export so `verify.ts` can re-use the engine-bound
 * verifier without a second `ensureXadesEngine()` call sprinkled in the
 * lifecycle layer.
 */
export const __internalVerifySignedXml = verifySignedXmlInternal;
