# Glossary

Terms agents will encounter in this codebase. Most are Spanish tax/SRI vocabulary that should **not** be translated in code (field names, state values, error codes) — translating them loses the mapping to the ficha técnica.

## SRI / tax

| Term                | Meaning                          | Notes                                                                                                                     |
| ------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **SRI**             | Servicio de Rentas Internas      | Ecuador's tax authority.                                                                                                  |
| **RUC**             | Registro Único de Contribuyentes | 13-digit tax ID for companies / individuals acting as taxpayers. Tenant identifier at SRI level.                          |
| **Cédula**          | National ID for natural persons  | 10 digits. Sometimes used instead of RUC for end-customer identification.                                                 |
| **Pasaporte**       | Passport                         | Fallback identification for foreign customers.                                                                            |
| **Esquema offline** | Offline scheme                   | The SRI emission model we implement: issuer signs locally, then sends and awaits authorization. The only scheme in scope. |
| **Ficha técnica**   | Technical sheet                  | The SRI document that defines XML schemas, rules, access key, etc. Lives under [`docs/sri/`](../../docs/sri/).            |
| **Ambiente**        | Environment                      | `1` = pruebas (testing), `2` = producción. Tenant-level config, not app-level.                                            |
| **Tipo de emisión** | Emission type                    | `1` = normal, `2` = contingencia (varies per ficha version).                                                              |

## Document types

| Term                         | Meaning                                                           | XSD                               |
| ---------------------------- | ----------------------------------------------------------------- | --------------------------------- |
| **Factura**                  | Invoice                                                           | `docs/sri/factura/`               |
| **Nota de crédito**          | Credit note (adjustment in favor of the customer)                 | `docs/sri/nota_credito/`          |
| **Nota de débito**           | Debit note (adjustment against the customer)                      | `docs/sri/nota_debito/`           |
| **Comprobante de retención** | Withholding receipt (tax withheld by the issuer on behalf of SRI) | `docs/sri/comprobante_retencion/` |

## Emission infrastructure

| Term                       | Meaning              | Notes                                                                                                                |
| -------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Establecimiento**        | Business location    | 3-digit code per tenant. A tenant can have many.                                                                     |
| **Punto de emisión**       | Emission point       | 3-digit code, scoped to an establecimiento. Each has its own document sequence.                                      |
| **Secuencial**             | Sequence number      | 9-digit consecutive number per (tenant, establecimiento, punto de emisión, document type). Must never skip or reuse. |
| **Clave de acceso**        | Access key           | 49-digit unique identifier computed from tenant + document metadata. Validated by SRI.                               |
| **Número de autorización** | Authorization number | In offline scheme, equal to the access key.                                                                          |

## States and flows

| Term              | Meaning                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| **Recepción**     | First SRI call: submit signed XML for validation.                                                        |
| **Autorización**  | Second SRI call: confirm the document is legally valid.                                                  |
| **Devuelta**      | Rejected at recepción.                                                                                   |
| **No autorizado** | Rejected at autorización.                                                                                |
| **Autorizado**    | Terminal success state.                                                                                  |
| **Contingencia**  | Fallback flow when SRI is unreachable.                                                                   |
| **RIDE**          | Representación Impresa del Documento Electrónico — printable/PDF version, generated after authorization. |

## Signing

| Term                    | Meaning                                                         |
| ----------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Certificado digital** | Digital certificate                                             | PKCS#12 (`.p12` / `.pfx`) issued by an accredited Ecuadorian CA. |
| **XAdES-BES**           | XML Advanced Electronic Signatures — Basic Electronic Signature | Signature format required by SRI.                                |
| **Firmante**            | Signer                                                          | Usually the legal representative of the tenant.                  |

## Internal / cross-cutting

| Term                 | Meaning                                                     |
| -------------------- | ----------------------------------------------------------- |
| **Tenant / company** | A single RUC-owning organization in our multi-tenant model. |
| **Membership**       | A user's link to a tenant, with a role.                     |
| **SRI Core**         | Our `apps/sri-core` service — the SRI facilitator.          |
| **API**              | Our `apps/api` service — business backend.                  |
| **Web**              | Our `apps/web` service — end-user frontend.                 |

## What not to rename

Keep these Spanish terms verbatim in code, DB columns, state enums and logs: `ruc`, `cedula`, `claveAcceso`, `ambiente`, `tipoEmision`, `establecimiento`, `puntoEmision`, `secuencial`, document-state values (`GENERADO`, `FIRMADO`, `ENVIADO`, `RECIBIDA`, `AUTORIZADO`, `NO_AUTORIZADO`, `DEVUELTA`, `EN_CONTINGENCIA`). Translating them breaks traceability to the ficha técnica and to SRI responses.
