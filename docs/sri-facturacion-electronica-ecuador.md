# Facturación Electrónica SRI Ecuador — Know-How completo

Documento de referencia agnóstico para implementar **emisión de comprobantes electrónicos** ante el **Servicio de Rentas Internas (SRI) de Ecuador** bajo el **esquema OFFLINE** (Ficha Técnica v2.32, vigente).

Cubre: factura, nota de crédito, nota de débito, comprobante de retención y guía de remisión. La lógica es la misma; sólo cambian los XSD/XML y algunos códigos.

---

## Tabla de contenido

1. [Conceptos fundamentales](#1-conceptos-fundamentales)
2. [Certificado de firma digital](#2-certificado-de-firma-digital-p12pfx)
3. [Numeración: establecimiento, punto de emisión, secuencial](#3-numeración-establecimiento-punto-de-emisión-secuencial)
4. [Clave de Acceso (49 dígitos)](#4-clave-de-acceso-49-dígitos)
5. [Tipos de comprobantes y versiones XSD](#5-tipos-de-comprobantes-y-versiones-xsd)
6. [Estructura del XML (factura V2.1.0)](#6-estructura-del-xml-factura-v210)
7. [Estructuras XML de otros comprobantes](#7-estructuras-xml-de-otros-comprobantes)
8. [Reglas de formato y validación](#8-reglas-de-formato-y-validación-de-datos)
9. [Catálogos SRI](#9-catálogos-sri)
10. [Firma electrónica XAdES-BES](#10-firma-electrónica-xades-bes)
11. [Web Services del SRI (SOAP)](#11-web-services-del-sri-soap)
12. [Flujo completo de emisión](#12-flujo-completo-de-emisión-paso-a-paso)
13. [Estados del comprobante](#13-estados-del-comprobante)
14. [Mensajes y manejo de errores](#14-mensajes-y-manejo-de-errores-del-sri)
15. [RIDE (representación impresa)](#15-ride-representación-impresa-del-documento-electrónico)
16. [Almacenamiento y entrega](#16-almacenamiento-y-entrega-al-receptor)
17. [Reintentos, polling, idempotencia y contingencia](#17-reintentos-polling-idempotencia-y-contingencia)
18. [Buenas prácticas y errores comunes](#18-buenas-prácticas-y-errores-comunes)
19. [Checklist de implementación](#19-checklist-de-implementación)
20. [Anexo A — Endpoints WSDL](#anexo-a--endpoints-y-wsdl)
21. [Anexo B — Recursos oficiales](#anexo-b--recursos-oficiales)

---

## 1. Conceptos fundamentales

### Esquema OFFLINE

Desde Nov-2014 el SRI opera bajo **esquema offline**:

1. El contribuyente **genera** el XML, lo **firma** y lo **envía** al SRI para recepción.
2. El SRI valida formalmente el XML (estructura, firma, RUC, secuencial) y devuelve **RECIBIDA** o **DEVUELTA**.
3. Después (segundos o pocos minutos) el SRI procesa una **autorización** asíncrona que devuelve **AUTORIZADO** o **NO AUTORIZADO**.
4. Sólo cuando esté **AUTORIZADO** el comprobante tiene validez tributaria y debe entregarse al receptor (XML + RIDE PDF).

El emisor debe **encolar y consultar** la autorización; no es síncrona con la recepción.

### Ambientes

| Ambiente                | Código | Uso                                                                                   |
| ----------------------- | ------ | ------------------------------------------------------------------------------------- |
| Pruebas (Certificación) | `1`    | URLs `celcer.sri.gob.ec`. Para QA. Los comprobantes **no tienen validez tributaria**. |
| Producción              | `2`    | URLs `cel.sri.gob.ec`. Único ambiente con validez fiscal.                             |

### Tipo de emisión

| Tipo                            | Código       | Cuándo                                                                                                                         |
| ------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Normal                          | `1`          | Caso general (servicios SRI disponibles).                                                                                      |
| Contingencia / Indisponibilidad | (deprecated) | Antes existía `2`. Hoy el SRI **acepta hasta 72 h** para enviar comprobantes, así que se emite siempre con `1` y se reintenta. |

### Plazo de emisión

- El comprobante debe ser **enviado al SRI dentro de las 72 horas** siguientes a la fecha de emisión (`fechaEmision`).
- Si se vence, el SRI rechaza con error de "comprobante caducado".
- `fechaEmision` se incluye dentro de la **clave de acceso**, por lo que **no se puede falsear**.

---

## 2. Certificado de firma digital (.p12/.pfx)

### Requisitos

- Estándar **PKCS#12** (`.p12` o `.pfx`), conteniendo:
  - Clave privada RSA (típicamente 2048 bits).
  - Certificado X.509 del titular.
  - Cadena de confianza (opcional pero recomendado).
- **Emisores autorizados en Ecuador**:
  - Banco Central del Ecuador (BCE/Eficert) — más común.
  - Security Data.
  - Anf AC.
  - Consejo de la Judicatura (ICERT-EC).
  - Uanataca / Digercic.
- Debe estar **vigente** (validate `notBefore <= now <= notAfter`).
- El titular del certificado debe ser **la persona natural o el representante legal** de la empresa identificada por el RUC.

### Almacenamiento seguro

- **Nunca** commitear el `.p12` ni la clave en repositorio.
- Guardar en **almacenamiento cifrado** (S3 con SSE, Vault, KMS, Secrets Manager, o tabla con columna encriptada).
- La **passphrase** del `.p12` debe almacenarse cifrada (no en texto plano).
- En base de datos persistir metadatos útiles: `serialNumber`, `subjectDn`, `issuer`, `validFrom`, `validTo`, `status` (`ACTIVE` | `EXPIRED` | `INACTIVE`).
- Soportar **rotación** sin reiniciar servicio: leer el certificado activo por organización al momento de firmar.

### Parseo del .p12 (Node.js, `node-forge`)

```js
const forge = require("node-forge");

function parseP12(p12Buffer, passphrase) {
  const p12Der = forge.util.decode64(p12Buffer.toString("base64"));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });

  const cert = certBags[forge.pki.oids.certBag][0].cert;
  const privateKey = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;

  return {
    cert,
    privateKey,
    serialNumber: cert.serialNumber,
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
    subjectDn: cert.subject.attributes.map((a) => `${a.shortName || a.type}=${a.value}`).join(", "),
  };
}
```

---

## 3. Numeración: establecimiento, punto de emisión, secuencial

| Campo        | Longitud                                   | Descripción                                                          |
| ------------ | ------------------------------------------ | -------------------------------------------------------------------- |
| `estab`      | 3 dígitos                                  | Código del establecimiento (sucursal). Ej: `001`.                    |
| `ptoEmi`     | 3 dígitos                                  | Código del punto de emisión dentro del establecimiento. Ej: `001`.   |
| `secuencial` | 9 dígitos, padded a la izquierda con ceros | Numerador propio por combinación `(estab, ptoEmi, tipoComprobante)`. |

**Reglas de oro:**

- El secuencial debe ser **estrictamente creciente y sin huecos** dentro de cada `(estab, ptoEmi, codDoc)`. El SRI rechaza secuenciales fuera de orden o saltados de manera anómala.
- Si un comprobante es rechazado/devuelto y no se va a corregir, ese secuencial **queda quemado** (el SRI no permite reutilizarlo en otro comprobante con la misma clave). Por eso conviene tener **una transacción de DB que reserve el secuencial** justo antes de armar el XML y guardarlo localmente aún si falla la transmisión, para reintentar luego con la misma clave.
- Nunca generar secuenciales en paralelo sin lock; usar `SERIALIZABLE`, `SELECT ... FOR UPDATE` o una secuencia DB.

```sql
-- Patrón seguro (Postgres)
SELECT nextval('seq_factura_001_001') AS secuencial;
-- O bien:
UPDATE emission_points
   SET next_sequential = next_sequential + 1
 WHERE id = :id
RETURNING next_sequential - 1 AS secuencial;
```

---

## 4. Clave de Acceso (49 dígitos)

Identificador único del comprobante, embebido en el XML y usado en todo el ciclo.

### Composición

| Pos   | Campo                                                               | Long | Valor / Formato                                           |
| ----- | ------------------------------------------------------------------- | ---- | --------------------------------------------------------- |
| 1–8   | Fecha de emisión                                                    | 8    | `ddmmaaaa`                                                |
| 9–10  | Tipo de comprobante (`codDoc`)                                      | 2    | `01` factura, `04` NC, `05` ND, `06` guía, `07` retención |
| 11–23 | RUC del emisor                                                      | 13   | Numérico                                                  |
| 24    | Ambiente                                                            | 1    | `1` pruebas, `2` producción                               |
| 25–27 | Serie (`estab` + `ptoEmi`)                                          | 6    | Concatenación de los dos códigos                          |
| 28–36 | Secuencial                                                          | 9    | Padded con ceros a la izquierda                           |
| 37–44 | Código numérico                                                     | 8    | Aleatorio numérico generado por el emisor                 |
| 45    | Tipo de emisión                                                     | 1    | `1` normal                                                |
| 46–48 | (reservados dentro de la serie/secuencial, parte de los anteriores) | —    | —                                                         |
| 49    | **Dígito verificador**                                              | 1    | Módulo 11 sobre los 48 dígitos anteriores                 |

**Total**: 48 dígitos de "base" + 1 de verificación = **49 dígitos exactos**.

### Algoritmo del dígito verificador — Módulo 11

Pesos `[2, 3, 4, 5, 6, 7]` aplicados **de derecha a izquierda**, cíclicos.

```js
function computeModulo11CheckDigit(numericString) {
  const weights = [2, 3, 4, 5, 6, 7];
  let sum = 0;
  let widx = 0;
  for (let i = numericString.length - 1; i >= 0; i--) {
    sum += Number(numericString[i]) * weights[widx];
    widx = (widx + 1) % weights.length;
  }
  const check = 11 - (sum % 11);
  if (check === 11) return "0";
  if (check === 10) return "1";
  return String(check);
}

function buildAccessKey({
  fecha,
  codDoc,
  ruc,
  ambiente,
  serie,
  secuencial,
  codigoNumerico,
  tipoEmision,
}) {
  const base48 = `${fecha}${codDoc}${ruc}${ambiente}${serie}${secuencial}${codigoNumerico}${tipoEmision}`;
  if (base48.length !== 48) throw new Error(`base must be 48 digits, got ${base48.length}`);
  return base48 + computeModulo11CheckDigit(base48);
}
```

**Notas críticas:**

- La clave de acceso es **única e inmutable** una vez emitida. No se puede regenerar para reintentar; debe persistirse en DB al crear el comprobante local.
- El `codigoNumerico` lo elige libremente el emisor. Generarlo aleatorio (`crypto.randomInt`) ayuda a evitar colisiones cuando se reenvía.
- `fechaEmision` dentro de la clave debe coincidir **exactamente** con el campo `<fechaEmision>` del XML.

---

## 5. Tipos de comprobantes y versiones XSD

| Tipo                     | `codDoc` | XSD vigente                       | Elemento raíz            |
| ------------------------ | -------- | --------------------------------- | ------------------------ |
| Factura                  | `01`     | `factura_V2.1.0.xsd`              | `<factura>`              |
| Liquidación de compra    | `03`     | (Existe esquema propio)           | —                        |
| Nota de Crédito          | `04`     | `NotaCredito_V1.1.0.xsd`          | `<notaCredito>`          |
| Nota de Débito           | `05`     | `NotaDebito_V1.0.0.xsd`           | `<notaDebito>`           |
| Guía de Remisión         | `06`     | `GuiaRemision_V_1_1_0.xsd`        | `<guiaRemision>`         |
| Comprobante de Retención | `07`     | `ComprobanteRetencion_V2.0.0.xsd` | `<comprobanteRetencion>` |

Cada comprobante:

- Comparte el bloque **`<infoTributaria>`** (mismo formato).
- Tiene un bloque específico: `<infoFactura>`, `<infoNotaCredito>`, `<infoNotaDebito>`, `<infoCompRetencion>`, etc.
- Tiene bloque(s) de detalle: `<detalles>`, `<docsSustento>`, `<motivos>`, etc.
- Opcionalmente: `<infoAdicional>`, `<maquinaFiscal>`.

> **Recomendación**: Versionar el XSD en la app (carpeta `schemas/`). Permite validar el XML antes de firmar contra el esquema oficial (con `libxmljs2`, `xmllint`, etc.) y detectar errores antes de gastar reintentos contra el SRI.

---

## 6. Estructura del XML (factura V2.1.0)

### Plantilla mínima

```xml
<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="2.1.0">
  <infoTributaria>...</infoTributaria>
  <infoFactura>...</infoFactura>
  <detalles>
    <detalle>...</detalle>
    ...
  </detalles>
  <!-- Opcionales -->
  <reembolsos>...</reembolsos>
  <retenciones>...</retenciones>
  <infoSustitutivaGuiaRemision>...</infoSustitutivaGuiaRemision>
  <otrosRubrosTerceros>...</otrosRubrosTerceros>
  <tipoNegociable>...</tipoNegociable>
  <maquinaFiscal>...</maquinaFiscal>
  <infoAdicional>
    <campoAdicional nombre="...">...</campoAdicional>
  </infoAdicional>
</factura>
```

### Reglas estructurales esenciales

1. **El elemento raíz debe llevar `id="comprobante"`**. Es el `URI` que referencia la firma XAdES (`<Reference URI="#comprobante">`).
2. **El atributo `version`** debe coincidir con la versión XSD usada (`2.1.0` para factura).
3. **El orden de los elementos importa**: el XSD define una secuencia (`<xs:sequence>`); cambiar el orden invalida.
4. **No incluir elementos vacíos** opcionales — el SRI rechaza tags como `<placa></placa>` si no hay valor. Omitir el tag completo.
5. **Codificación**: UTF-8. La declaración XML debe ser literalmente `<?xml version="1.0" encoding="UTF-8"?>`.
6. **No usar saltos de línea ni espacios entre elementos** que afecten la canonización (la firma fija el contenido). Estilo "single line" es lo más seguro.

### `<infoTributaria>` — campos

| Campo                | Long      | Obligatorio | Valor                                                                                   |
| -------------------- | --------- | ----------- | --------------------------------------------------------------------------------------- |
| `ambiente`           | 1         | Sí          | `1` o `2`                                                                               |
| `tipoEmision`        | 1         | Sí          | `1`                                                                                     |
| `razonSocial`        | 3–300     | Sí          | Texto                                                                                   |
| `nombreComercial`    | 3–300     | No          | Texto                                                                                   |
| `ruc`                | 13        | Sí          | Numérico                                                                                |
| `claveAcceso`        | 49        | Sí          | Generada (sección 4)                                                                    |
| `codDoc`             | 2         | Sí          | Tipo comprobante                                                                        |
| `estab`              | 3         | Sí          | Numérico                                                                                |
| `ptoEmi`             | 3         | Sí          | Numérico                                                                                |
| `secuencial`         | 9         | Sí          | Numérico, padded                                                                        |
| `dirMatriz`          | 1–300     | Sí          | Texto                                                                                   |
| `agenteRetencion`    | 1         | No          | Si la empresa es agente, indicar nro de resolución.                                     |
| `contribuyenteRimpe` | hasta 300 | No          | Ej. `"CONTRIBUYENTE RÉGIMEN RIMPE"`. Aplica para los acogidos al régimen RIMPE (2022+). |

### `<infoFactura>` — campos relevantes

| Campo                         | Notas                                                               |
| ----------------------------- | ------------------------------------------------------------------- |
| `fechaEmision`                | Formato **`dd/mm/aaaa`** (con `/`).                                 |
| `dirEstablecimiento`          | Dirección de la sucursal emisora.                                   |
| `contribuyenteEspecial`       | Resolución si aplica (3–13 dígitos).                                |
| `obligadoContabilidad`        | `SI` / `NO`.                                                        |
| `tipoIdentificacionComprador` | Catálogo (sección 9).                                               |
| `razonSocialComprador`        | Hasta 300 caracteres.                                               |
| `identificacionComprador`     | RUC / cédula / pasaporte / `9999999999999` para consumidor final.   |
| `direccionComprador`          | Opcional, recomendado siempre que se tenga.                         |
| `totalSinImpuestos`           | Suma de subtotales sin IVA/ICE. 2 decimales.                        |
| `totalDescuento`              | 2 decimales.                                                        |
| `totalConImpuestos`           | Agrupación de impuestos. Ver abajo.                                 |
| `propina`                     | 10 % servicio, si aplica.                                           |
| `importeTotal`                | Total final a cobrar. 2 decimales.                                  |
| `moneda`                      | `DOLAR` para Ecuador (USD es la moneda oficial).                    |
| `pagos`                       | Lista de `<pago>` con forma de pago, monto, plazo. **Obligatorio**. |

#### Bloque `<totalConImpuestos>` (factura)

```xml
<totalConImpuestos>
  <totalImpuesto>
    <codigo>2</codigo>              <!-- 2 = IVA -->
    <codigoPorcentaje>4</codigoPorcentaje> <!-- 4 = 15% (vigente desde abr-2024) -->
    <baseImponible>100.00</baseImponible>
    <valor>15.00</valor>
  </totalImpuesto>
</totalConImpuestos>
```

Agrupar por `(codigo, codigoPorcentaje)`. Sumar bases y valores.

#### Bloque `<pagos>` (factura)

```xml
<pagos>
  <pago>
    <formaPago>20</formaPago>     <!-- 20 = "Otros con utilización del sistema financiero" -->
    <total>115.00</total>
    <plazo>0</plazo>
    <unidadTiempo>dias</unidadTiempo>
  </pago>
</pagos>
```

### `<detalles>` — línea de producto/servicio

```xml
<detalle>
  <codigoPrincipal>SKU-001</codigoPrincipal>
  <codigoAuxiliar>ALT-001</codigoAuxiliar> <!-- opcional -->
  <descripcion>Servicio de mantenimiento</descripcion>
  <unidadMedida>UND</unidadMedida> <!-- opcional pero recomendado -->
  <cantidad>1.000000</cantidad>           <!-- 6 decimales -->
  <precioUnitario>100.000000</precioUnitario> <!-- 6 decimales -->
  <descuento>0.00</descuento>
  <precioTotalSinImpuesto>100.00</precioTotalSinImpuesto>
  <detallesAdicionales>
    <detAdicional nombre="Serie" valor="ABC123"/>
  </detallesAdicionales>
  <impuestos>
    <impuesto>
      <codigo>2</codigo>
      <codigoPorcentaje>4</codigoPorcentaje>
      <tarifa>15.00</tarifa>
      <baseImponible>100.00</baseImponible>
      <valor>15.00</valor>
    </impuesto>
  </impuestos>
</detalle>
```

**Precisión decimal:**

- `cantidad`, `precioUnitario`, `precioSinSubsidio`: **6 decimales** permitidos.
- `descuento`, `precioTotalSinImpuesto`, importes y totales: **2 decimales**.
- `tarifa` (porcentaje del impuesto): 2 decimales.
- `descripcion`: **máximo 300 caracteres**, sin saltos de línea. Sanitizar.

### `<infoAdicional>`

Campos opcionales libres (típicamente: email del cliente, teléfono, observaciones).

```xml
<infoAdicional>
  <campoAdicional nombre="email">cliente@example.com</campoAdicional>
  <campoAdicional nombre="telefono">0999999999</campoAdicional>
</infoAdicional>
```

Útil porque el `nombre="email"` aquí es la convención que muchas APIs del SRI usan para reenvíos automáticos al receptor.

---

## 7. Estructuras XML de otros comprobantes

### Nota de Crédito (`codDoc=04`, XSD V1.1.0)

- Raíz: `<notaCredito id="comprobante" version="1.1.0">`.
- `<infoNotaCredito>` con:
  - `codDocModificado`, `numDocModificado` (formato `estab-ptoEmi-secuencial`), `fechaEmisionDocSustento` → referencian la **factura original** que se está modificando.
  - `valorModificacion` → monto que se está acreditando.
  - `motivo` → texto libre del motivo.
- Detalles similares a factura pero los campos se llaman `codigoInterno`/`codigoAdicional` en lugar de `codigoPrincipal`/`codigoAuxiliar`.
- **No** lleva `<infoFactura>` ni `<pagos>` ni `<reembolsos>`.

### Nota de Débito (`codDoc=05`, XSD V1.0.0)

- Raíz: `<notaDebito>`.
- `<infoNotaDebito>` con referencia al doc modificado (igual que NC) + `valorTotal`.
- Lista de `<motivos>` con `<motivo><razon>...</razon><valor>...</valor></motivo>`.
- Lleva `<pagos>` (igual estructura que factura).

### Comprobante de Retención (`codDoc=07`, XSD V2.0.0)

> El SRI **eliminó retenciones en factura** y exige comprobante de retención independiente desde 2018.

- Raíz: `<comprobanteRetencion>`.
- `<infoCompRetencion>` con `periodoFiscal` (`mm/aaaa`), datos del sujeto retenido.
- Bloque clave: **`<docsSustento>`** — cada documento sobre el que se retiene:
  - `codSustento`, `codDocSustento`, `numDocSustento` (formato `estab-ptoEmi-secuencial`), `fechaEmisionDocSustento`, `numAutDocSustento`.
  - `impuestosDocSustento` (impuestos del doc original).
  - `<retenciones>` (las retenciones aplicadas; cada una con `codigo`, `codigoRetencion`, `baseImponible`, `porcentajeRetener`, `valorRetenido`).
  - `pagos` (formas de pago del doc original).

### Guía de Remisión (`codDoc=06`)

- Identificación del transportista (RUC, placa).
- Origen, destino, fechas de transporte.
- Detalles de la mercadería.
- Puede sustituirse incluyendo `<infoSustitutivaGuiaRemision>` dentro de la factura (transporte propio).

---

## 8. Reglas de formato y validación de datos

### Tipos de dato

| Tipo                 | Patrón                   | Ejemplo      |
| -------------------- | ------------------------ | ------------ |
| Fecha                | `dd/mm/aaaa`             | `19/05/2026` |
| Numérico (monetario) | `^\d{1,14}(\.\d{1,2})?$` | `15.00`      |
| Numérico (cantidad)  | `^\d{1,14}(\.\d{1,6})?$` | `1.500000`   |
| Texto                | `[^&<>]+` (escapar XML)  | —            |

### Sanitización

- **Escapar XML**: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&apos;`.
- **`descripcion` de detalle**: máximo 300 caracteres, eliminar `\n` y `\r` (reemplazar por espacio). Es la causa más común de rechazo "ERROR EN ESQUEMA XML".
- **RUC**: validar checksum (algoritmo módulo 11 propio del SRI, distinto al de la clave de acceso) antes de aceptar la factura.
- **Identificación de comprador**:
  - Cédula (10 dígitos) → validar dígito verificador.
  - RUC (13 dígitos) → terminar en `001`/`002`/etc. para personas naturales, `001` para sociedades.
  - Pasaporte → alfanumérico sin formato estricto.
  - Consumidor final → `9999999999999` (13 nueves), `razonSocial="CONSUMIDOR FINAL"`. **El SRI exige razón social y cédula reales cuando el monto supera USD 50 desde 2022.**

### Validaciones aritméticas

El SRI re-calcula y rechaza si no cuadran:

- `precioTotalSinImpuesto = (cantidad * precioUnitario) - descuento` (con 2 decimales).
- `totalSinImpuestos = SUM(detalles.precioTotalSinImpuesto)`.
- Por cada `totalImpuesto`: `valor = baseImponible * tarifa / 100` con tolerancia ±0.01.
- `importeTotal = totalSinImpuestos - totalDescuento + SUM(totalImpuesto.valor) + propina`.
- `SUM(pagos.total) = importeTotal`.

Implementar estas validaciones en el backend **antes** de armar el XML.

---

## 9. Catálogos SRI

### Tipo de identificación del comprador (`tipoIdentificacionComprador`)

| Código | Descripción                 |
| ------ | --------------------------- |
| `04`   | RUC                         |
| `05`   | Cédula                      |
| `06`   | Pasaporte                   |
| `07`   | Consumidor final            |
| `08`   | Identificación del exterior |

### Tipo de identificación del sujeto retenido (retención)

Mismo catálogo + `tipoSujetoRetenido` adicional (`01` persona natural, `02` sociedad).

### Códigos de impuesto (`codigo` en `<impuesto>`)

| Código | Impuesto                    |
| ------ | --------------------------- |
| `2`    | IVA                         |
| `3`    | ICE                         |
| `5`    | IRBPNR (botellas plásticas) |
| `6`    | ISD                         |
| `8`    | (Reservado)                 |

### `codigoPorcentaje` para IVA (`codigo=2`)

| Código | Tarifa                           | Vigencia                                   |
| ------ | -------------------------------- | ------------------------------------------ |
| `0`    | 0 %                              | Vigente                                    |
| `2`    | 12 %                             | Histórico (hasta mar-2024)                 |
| `3`    | 14 %                             | Histórico (2017)                           |
| `4`    | 15 %                             | **Vigente desde 01/04/2024** (Decreto 198) |
| `5`    | 5 %                              | Tarifa especial (construcción)             |
| `6`    | No objeto de IVA                 | Servicios exonerados                       |
| `7`    | Exento de IVA                    | Servicios específicos                      |
| `8`    | IVA diferenciado (otras tarifas) | —                                          |

> **Importante:** El SRI **rechaza** facturas con tarifa errónea para la fecha de emisión. Si tu sistema permite emisión retroactiva, calcular `codigoPorcentaje` según `fechaEmision`, no según la fecha actual.

### Formas de pago (`formaPago` en `<pago>`)

| Código | Descripción                                                   |
| ------ | ------------------------------------------------------------- |
| `01`   | Sin utilización del sistema financiero                        |
| `15`   | Compensación de deudas                                        |
| `16`   | Tarjeta de débito                                             |
| `17`   | Dinero electrónico                                            |
| `18`   | Tarjeta prepago                                               |
| `19`   | Tarjeta de crédito                                            |
| `20`   | Otros con utilización del sistema financiero (transferencias) |
| `21`   | Endoso de títulos                                             |

### Códigos de retención

- **Retención en la fuente (Impuesto a la Renta)**: tabla larga, depende del concepto (servicios profesionales 10 %, honorarios 8 %, transporte 1 %, etc.).
- **Retención de IVA**: 30 %, 70 %, 100 % según naturaleza del bien/servicio y tipo de contribuyente.

Mantener estos catálogos en **tablas de DB** o **constantes versionadas** porque el SRI los actualiza con resoluciones periódicas.

---

## 10. Firma electrónica XAdES-BES

### Requisitos del SRI

- **Estándar**: XAdES-BES (XML Advanced Electronic Signatures – Basic Electronic Signature).
- **Tipo**: **Enveloped** (la firma va dentro del propio XML, como hijo del raíz `<factura>` / `<notaCredito>` / etc.).
- **Algoritmos aceptados**:
  - `SignatureMethod`: `RSA-SHA1` (histórico, default) o `RSA-SHA256` (también aceptado).
  - `DigestMethod`: `SHA-1` o `SHA-256`.
  - `CanonicalizationMethod`: `http://www.w3.org/TR/2001/REC-xml-c14n-20010315` (C14N exclusivo no, inclusivo sí).
- **Transformaciones de la referencia**:
  1. `http://www.w3.org/2000/09/xmldsig#enveloped-signature`
  2. `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`
- **`Reference URI`**: `"#comprobante"` (apuntando al atributo `id="comprobante"` del raíz).
- **`KeyInfo`** debe incluir el certificado X.509 en `<X509Data><X509Certificate>` (DER base64).
- Los elementos XAdES requeridos: `<xades:SignedProperties>` con `<xades:SigningTime>`, `<xades:SigningCertificate>` (digest del cert), `<xades:SignedDataObjectProperties>`.
- Debe firmarse también el bloque `<xades:SignedProperties>` con una segunda `<Reference Type="http://uri.etsi.org/01903#SignedProperties">`.

### Implementación recomendada (Node.js)

**Stack probado**:

- `xadesjs` (firma XAdES nativa).
- `@xmldom/xmldom` (DOM parser).
- `xpath` (selector XPath para xadesjs).
- `xml-core` (engine de xadesjs).
- `node-forge` (parseo del .p12).
- WebCrypto nativo de Node.js (>= 16) vía `crypto.webcrypto`.

```js
const { webcrypto } = require("crypto");
const xadesjs = require("xadesjs");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const xpath = require("xpath");
const { setNodeDependencies } = require("xml-core");

// Setup engine (una sola vez en el proceso)
setNodeDependencies({
  DOMParser,
  XMLSerializer,
  DOMImplementation: new DOMParser().implementation,
  xpath,
});
xadesjs.Application.setEngine("NodeJS", webcrypto);

async function signSriXml({ xmlString, p12Buffer, passphrase, hash = "SHA-1" }) {
  const { privateKey, certB64 } = await loadP12ForXAdES(p12Buffer, passphrase, hash);

  const doc = new DOMParser().parseFromString(xmlString, "application/xml");
  const signedXml = new xadesjs.SignedXml(doc);

  await signedXml.Sign({ name: "RSASSA-PKCS1-v1_5" }, privateKey, doc, {
    x509: [certB64],
    signingCertificate: certB64,
    references: [
      {
        uri: "#comprobante",
        hash,
        transforms: ["enveloped", "c14n"],
      },
    ],
    signingTime: { value: new Date() },
  });

  return signedXml.toString();
}
```

### Errores frecuentes en la firma

1. **Falta el `id="comprobante"`** en el elemento raíz → `Reference URI="#comprobante"` queda colgada → SRI rechaza.
2. **El XML tiene whitespace inconsistente** entre la firma y la verificación → digest no coincide. Solución: serializar el XML como **una sola línea** o aplicar C14N antes de firmar.
3. **Hash distinto en `DigestMethod` y `SignatureMethod`** que el servicio rechaza.
4. **Certificado expirado o no aceptado por el SRI** (algunas CAs antiguas ya no se aceptan).
5. **BOM al inicio del XML** → invalida la canonización. Forzar UTF-8 sin BOM.
6. **No incluir el certificado completo** en `<X509Data>` (sólo subjects, sin DER).

### Validación de la firma antes de enviar

Antes de mandar al SRI, validar localmente con:

```js
const verifier = new xadesjs.SignedXml(doc);
verifier.LoadXml(signatureNode);
const ok = await verifier.Verify();
```

Si falla local, va a fallar en el SRI.

---

## 11. Web Services del SRI (SOAP)

El SRI expone **dos web services SOAP 1.1** sobre HTTPS, en cada ambiente:

### Endpoints

| Servicio         | Pruebas (Certificación)                                                                       | Producción                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Recepción**    | `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl`    | `https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl`    |
| **Autorización** | `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl` | `https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl` |

### Configuración HTTPS

- **TLS mínimo: 1.2**. Forzar `minVersion: 'TLSv1.2'` en el agente HTTPS.
- **Keep-alive recomendado** para reusar conexiones cuando se envían lotes.
- **Timeout** sugerido: 30 segundos. El SRI puede demorar.
- **Content-Type**: `text/xml; charset=utf-8`.
- **SOAPAction**: vacío (`""`).

### Envelope: Recepción

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ec="http://ec.gob.sri.ws.recepcion">
  <soapenv:Header/>
  <soapenv:Body>
    <ec:validarComprobante>
      <xml>{XML_FIRMADO_EN_BASE64}</xml>
    </ec:validarComprobante>
  </soapenv:Body>
</soapenv:Envelope>
```

> El XML firmado va **codificado en Base64** dentro del elemento `<xml>`.

### Respuesta de Recepción

```xml
<soap:Envelope xmlns:soap="...">
  <soap:Body>
    <ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion">
      <RespuestaRecepcionComprobante>
        <estado>RECIBIDA</estado> <!-- o DEVUELTA -->
        <comprobantes>
          <comprobante>
            <claveAcceso>...</claveAcceso>
            <mensajes>
              <mensaje>
                <identificador>43</identificador>
                <mensaje>CLAVE ACCESO REGISTRADA</mensaje>
                <informacionAdicional>...</informacionAdicional>
                <tipo>ERROR</tipo> <!-- o ADVERTENCIA, INFORMATIVO -->
              </mensaje>
            </mensajes>
          </comprobante>
        </comprobantes>
      </RespuestaRecepcionComprobante>
    </ns2:validarComprobanteResponse>
  </soap:Body>
</soap:Envelope>
```

**Estados de Recepción**:

- `RECIBIDA` — Pasó validaciones formales. **No significa autorización**; consultar el servicio de autorización después.
- `DEVUELTA` — Falló validación. Leer `<mensajes>` para identificar la causa. Corregir y reenviar (puede ser misma clave si el error fue transitorio o nueva clave si hay que cambiar datos).

### Envelope: Autorización

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ec="http://ec.gob.sri.ws.autorizacion">
  <soapenv:Header/>
  <soapenv:Body>
    <ec:autorizacionComprobante>
      <claveAccesoComprobante>{CLAVE_ACCESO_49}</claveAccesoComprobante>
    </ec:autorizacionComprobante>
  </soapenv:Body>
</soapenv:Envelope>
```

### Respuesta de Autorización

```xml
<soap:Envelope xmlns:soap="...">
  <soap:Body>
    <ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion">
      <RespuestaAutorizacionComprobante>
        <claveAccesoConsultada>...</claveAccesoConsultada>
        <numeroComprobantes>1</numeroComprobantes>
        <autorizaciones>
          <autorizacion>
            <estado>AUTORIZADO</estado> <!-- o NO AUTORIZADO, EN PROCESO -->
            <numeroAutorizacion>...</numeroAutorizacion>
            <fechaAutorizacion>2026-05-19T10:34:21-05:00</fechaAutorizacion>
            <ambiente>PRODUCCION</ambiente>
            <comprobante><![CDATA[<?xml version="1.0"?><factura>...</factura>]]></comprobante>
            <mensajes/>
          </autorizacion>
        </autorizaciones>
      </RespuestaAutorizacionComprobante>
    </ns2:autorizacionComprobanteResponse>
  </soap:Body>
</soap:Envelope>
```

**Estados de Autorización**:

- `AUTORIZADO` — Comprobante válido fiscalmente. Guardar `numeroAutorizacion`, `fechaAutorizacion` y el `<comprobante>` (XML firmado autorizado).
- `NO AUTORIZADO` — Rechazado por reglas tributarias o de negocio (no por estructura, eso lo capta recepción).
- `EN PROCESO` — Aún no procesado. Reconsultar después de unos segundos.
- `RECHAZADA` — Variante de NO AUTORIZADO.

### Parser de la respuesta

Cuidado con el namespace, que cambia entre `http://ec.gob.sri.ws.recepcion` y `http://ec.gob.sri.ws.autorizacion`. Hay implementaciones del SRI donde los `mensajes` internos vienen sin namespace prefix; usar XPaths con fallback:

```js
// Pseudocódigo robusto
const estado = selectWithNs("//a:autorizacion/a:estado") || selectXpath("//estado");

const mensajes =
  selectWithNs("//a:autorizacion/a:mensajes/a:mensaje") ||
  selectXpath("//autorizacion/mensajes/mensaje") ||
  selectXpath("//mensajes/mensaje");
```

---

## 12. Flujo completo de emisión paso a paso

```
┌─────────────────────────────────────────────────────────────────┐
│  1. INPUT: payload de negocio                                   │
│     (cliente, ítems, totales, formas de pago)                   │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. VALIDACIÓN DE NEGOCIO                                       │
│     - Cliente válido, RUC/cédula con checksum                   │
│     - Aritmética (subtotales, IVA, total)                       │
│     - Catálogos (formas de pago, tarifas IVA vigentes)          │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. RESERVAR SECUENCIAL (DB transaccional)                      │
│     - Incrementar contador por (estab, ptoEmi, codDoc)          │
│     - Persistir registro local con estado = "PENDIENTE"         │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. GENERAR CLAVE DE ACCESO (49 dígitos, sección 4)             │
│     - Persistir junto al comprobante                            │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. CONSTRUIR XML (sección 6)                                   │
│     - Respeta orden del XSD                                     │
│     - Escape XML, sanitización descripcion, 2/6 decimales       │
│     - id="comprobante" en raíz                                  │
│     - (Opcional pero recomendado) validar contra XSD            │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. FIRMAR XAdES-BES (sección 10)                               │
│     - Cargar .p12 activo de la organización                     │
│     - Firma enveloped con Reference URI="#comprobante"          │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. ENVIAR A RECEPCIÓN (SOAP)                                   │
│     - Base64 del XML firmado en <xml>                           │
│     - 30s timeout, TLS 1.2+                                     │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
                  ┌────────┴────────┐
                  │   ¿Estado?      │
                  └────────┬────────┘
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        DEVUELTA      RECIBIDA      Error red
              │            │            │
              ▼            ▼            ▼
   [Persistir       [Estado:        [Reintento
    mensajes,        RECIBIDA,       exponencial.
    marcar como      avanzar a       Después de N
    DEVUELTA.        autorización]   intentos: estado
    Notificar al                     ERROR_RED]
    operador.
    Permitir
    edición y
    reenvío]
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  8. CONSULTAR AUTORIZACIÓN (SOAP)                               │
│     - Enviar claveAcceso                                        │
│     - Puede demorar; reintento con backoff hasta N veces        │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
                  ┌────────┴────────┐
                  │   ¿Estado?      │
                  └────────┬────────┘
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
  AUTORIZADO        NO AUTORIZADO         EN PROCESO
        │                  │                  │
        ▼                  ▼                  ▼
[Persistir         [Persistir mensajes,  [Encolar para
 numeroAuto,        estado NO_AUTORIZADO, reintentar
 fecha y XML         notificar.            (job programado
 autorizado.         No reutilizable]      cada N min)]
 Generar RIDE
 PDF.
 Enviar al
 receptor]
```

### Pseudocódigo de orquestación

```js
async function emitirComprobante(payload) {
  await validarNegocio(payload);
  const secuencial = await reservarSecuencial(payload.estab, payload.ptoEmi, payload.codDoc);
  const claveAcceso = generarClaveAcceso({ ...payload, secuencial });

  const comprobante = await persistir({
    ...payload,
    secuencial,
    claveAcceso,
    estado: "PENDIENTE",
  });

  const xml = construirXml({ ...payload, secuencial, claveAcceso });
  const xmlFirmado = await firmarXAdES(xml);

  const recepcion = await sendRecepcion(xmlFirmado);
  await persistirEventoSri({
    comprobanteId: comprobante.id,
    etapa: "RECEPCION",
    respuesta: recepcion,
  });

  if (recepcion.estado === "DEVUELTA") {
    await marcarComoDevuelta(comprobante.id, recepcion.mensajes);
    return { estado: "DEVUELTA", mensajes: recepcion.mensajes };
  }

  // RECIBIDA → consultar autorización (puede tardar)
  const autorizacion = await consultarAutorizacionConReintentos(claveAcceso, {
    maxIntentos: 5,
    delayInicial: 2000,
  });
  await persistirEventoSri({
    comprobanteId: comprobante.id,
    etapa: "AUTORIZACION",
    respuesta: autorizacion,
  });

  if (autorizacion.estado === "AUTORIZADO") {
    await marcarComoAutorizado(comprobante.id, autorizacion);
    await generarYAlmacenarRide(comprobante.id);
    await enviarAlReceptor(comprobante.id); // email/portal
  } else if (autorizacion.estado === "NO AUTORIZADO") {
    await marcarComoNoAutorizado(comprobante.id, autorizacion.mensajes);
  } else {
    await encolarParaReintento(comprobante.id);
  }

  return autorizacion;
}
```

---

## 13. Estados del comprobante

Modelar **dos campos** de estado:

- **Estado local del comprobante** (negocio): `BORRADOR | EMITIDO | ANULADO`.
- **Estado SRI** (técnico): `PENDIENTE | RECIBIDA | DEVUELTA | RECHAZADA | AUTORIZADO | NO_AUTORIZADO | ERROR_RED`.

### Máquina de estados sugerida

```
PENDIENTE ──recepción RECIBIDA──▶ RECIBIDA ──autorización AUTORIZADO──▶ AUTORIZADO ✓
    │                                │
    │                                └──autorización NO_AUTORIZADO──▶ NO_AUTORIZADO
    │
    └──recepción DEVUELTA──▶ DEVUELTA ──(corregir y reenviar)──▶ PENDIENTE
    │
    └──error red──▶ ERROR_RED ──(reintento)──▶ PENDIENTE
```

### Estados re-enviables

Sólo desde estos estados un comprobante puede volver a enviarse a recepción:

- `PENDIENTE`, `DEVUELTA`, `RECHAZADA`, `ERROR_RED`.

Nunca reenviar uno ya `AUTORIZADO` (idempotencia tributaria).

### Mapeo de respuestas SRI → estado interno

```js
function normalizeSriStatus(estadoSri) {
  const s = (estadoSri || "").trim().toUpperCase();
  if (s === "AUTORIZADO") return "AUTORIZADO";
  if (s === "NO AUTORIZADO" || s === "NO_AUTORIZADO" || s === "RECHAZADA") return "NO_AUTORIZADO";
  if (s === "EN PROCESO" || s === "EN_PROCESO") return "EN_PROCESO";
  if (s === "RECIBIDA") return "RECIBIDA";
  if (s === "DEVUELTA") return "DEVUELTA";
  return "DESCONOCIDO";
}
```

---

## 14. Mensajes y manejo de errores del SRI

### Estructura del mensaje

```xml
<mensaje>
  <identificador>43</identificador>
  <mensaje>CLAVE ACCESO REGISTRADA</mensaje>
  <informacionAdicional>...</informacionAdicional>
  <tipo>ERROR</tipo>
</mensaje>
```

**Tipos**:

- `ERROR` — bloqueante.
- `ADVERTENCIA` — no bloqueante, pero registrar.
- `INFORMATIVO` — sólo informativo.

### Identificadores comunes (no exhaustivo, ver Ficha Técnica)

| ID   | Mensaje                           | Causa típica                                                                                      |
| ---- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `26` | ERROR EN ESTRUCTURA / ESQUEMA XML | XSD no se cumple (campo faltante, orden, tipo).                                                   |
| `35` | ARCHIVO NO CUMPLE ESTRUCTURA XML  | Falta declaración XML, BOM, encoding incorrecto.                                                  |
| `39` | FIRMA INVÁLIDA                    | Certificado expirado o firma corrupta.                                                            |
| `43` | CLAVE DE ACCESO REGISTRADA        | Reenvío de un comprobante ya recibido (idempotencia: tratar como éxito y consultar autorización). |
| `45` | ERROR GENERAL                     | Error interno del SRI; reintentar.                                                                |
| `50` | ERROR EN DIFERENCIA DE TOTALES    | Aritmética no cuadra (totales vs líneas).                                                         |
| `52` | ERROR EN LA SECUENCIA             | Secuencial fuera de orden.                                                                        |
| `60` | CÓDIGO IMPUESTO NO EXISTE         | `codigoPorcentaje` no es válido para la fecha.                                                    |
| `65` | RUC SIN AUTORIZACIÓN              | El RUC del emisor no está habilitado para facturación electrónica.                                |
| `70` | ERROR EN FECHAS                   | `fechaEmision` futura o > 72h en el pasado.                                                       |

### Estrategia de manejo

```js
function clasificarError(mensaje) {
  const id = mensaje.identificador;

  // Reintentable: probablemente transitorio
  if (["45"].includes(id)) return "RETRY";

  // Idempotente: ya estaba registrada, ir directo a autorización
  if (id === "43") return "ALREADY_RECEIVED";

  // Bloqueante de negocio: requiere intervención manual
  if (["26", "50", "52", "60", "70"].includes(id)) return "BUSINESS_ERROR";

  // Bloqueante de credenciales: requiere admin
  if (["39", "65"].includes(id)) return "CONFIG_ERROR";

  return "UNKNOWN";
}
```

Persistir **todos los mensajes** del SRI (tabla `sri_events` o similar) para auditoría y para que el operador vea exactamente qué dijo el SRI.

---

## 15. RIDE (Representación Impresa del Documento Electrónico)

El RIDE es el PDF entregable al cliente. **No reemplaza** al XML autorizado, pero es el documento "visible".

### Requisitos legales mínimos (Resolución NAC-DGERCGC18-00000233 y similares)

1. **Encabezado**: razón social, nombre comercial, RUC, dirección matriz, dirección sucursal.
2. **Datos del comprobante**:
   - Tipo (FACTURA / NOTA DE CRÉDITO / etc.).
   - Número (`estab-ptoEmi-secuencial`, ej. `001-001-000000123`).
   - **Número de autorización** (es el `claveAcceso` desde 2014; sí, son el mismo número de 49 dígitos).
   - **Fecha y hora de autorización**.
   - Ambiente (PRODUCCIÓN / PRUEBAS).
   - Tipo de emisión (NORMAL).
   - **Clave de acceso (49 dígitos)** en texto **y como código de barras** (formato Code 128 o similar).
3. **Datos del comprador**: identificación, razón social, dirección, teléfono, correo.
4. **Detalle de líneas**: código principal, descripción, cantidad, precio unitario, descuento, total.
5. **Totales**: subtotal por cada tarifa (15 %, 0 %, exento), IVA, ICE, descuento total, propina, total.
6. **Forma de pago**: tabla con método y monto.
7. **Información adicional**: campos del `<infoAdicional>` del XML.
8. **Leyenda**: "Documento autorizado por el SRI" + URL del visor público del SRI.

### Stack típico (Node.js)

- **PDFKit** o **pdfmake** para layout manual.
- **bwip-js** o **jsbarcode** para el código de barras Code 128 de la clave.

### Cuándo generarlo

Sólo **después** de recibir `AUTORIZADO`. Antes el `numeroAutorizacion` no existe.

### Almacenamiento

- Guardar el **XML autorizado** (el `<comprobante>` retornado en la respuesta de autorización, que incluye el bloque de autorización del SRI). Conservar al menos **7 años** (plazo de prescripción tributaria).
- Guardar el **RIDE PDF** generado.
- Usar almacenamiento objeto (S3, Spaces, GCS) con **versionado** y **acceso firmado** (URLs temporales para descarga).

---

## 16. Almacenamiento y entrega al receptor

### Estructura sugerida de almacenamiento

```
documentos/
  {ruc-emisor}/
    {anio}/
      {mes}/
        {claveAcceso}.xml         # XML autorizado (con bloque de autorización)
        {claveAcceso}.pdf         # RIDE PDF
        {claveAcceso}.signed.xml  # Backup del XML firmado pre-autorización (opcional)
```

Ventajas: rutas predecibles, fácil de respaldar, recuperación por clave de acceso directa.

### Entrega al receptor

**Obligación legal**: el emisor debe entregar al receptor el RIDE y el XML autorizado por:

- Correo electrónico (canal más común).
- Portal web.
- Mensajería (WhatsApp, etc.).
- Impresión física (si el receptor lo solicita).

**Template de correo recomendado**:

```
Asunto: Factura electrónica {numero} - {razonSocialEmisor}
Adjuntos:
  - {claveAcceso}.xml
  - {claveAcceso}.pdf
Cuerpo:
  Estimado {razonSocialReceptor},
  Adjunto encontrará la factura electrónica número {numero}
  por un monto de USD {importeTotal}, autorizada por el SRI.
  Clave de acceso: {claveAcceso}
  Fecha de autorización: {fechaAutorizacion}
```

---

## 17. Reintentos, polling, idempotencia y contingencia

### Idempotencia (clave de acceso = identificador natural)

- Si el SRI ya recibió un comprobante (mensaje `43 - CLAVE ACCESO REGISTRADA`), **no es un error**. Significa que se puede saltar directo a consultar autorización.
- Nunca regenerar la clave para "forzar" un reenvío de un comprobante ya registrado.

### Job de polling para autorización

Procesos en estado `RECIBIDA` o `EN_PROCESO` deben tener un **job cron** que:

1. Cada N minutos (sugerido: 1–5 min en producción).
2. Toma N comprobantes (sugerido: 50–100) con `estado IN (RECIBIDA, EN_PROCESO, ERROR_RED)` y `updatedAt < now - 1min`.
3. Consulta autorización de cada uno.
4. Actualiza estado, persiste eventos.
5. Hace **delay entre llamadas** (sugerido: 500–1000 ms) para no saturar al SRI.

```js
async function batchPollAuthorization() {
  const pending = await repo.findPendingAuthorization({ limit: 50, olderThanMinutes: 2 });
  for (const c of pending) {
    try {
      const auth = await consultarAutorizacion(c.claveAcceso);
      await actualizarEstado(c.id, auth);
    } catch (err) {
      logger.error("poll error", { id: c.id, err });
    }
    await sleep(1000);
  }
}
```

### Reintentos en recepción

- **Backoff exponencial**: 2s, 4s, 8s, 16s... hasta máximo 5 reintentos.
- No reintentar errores de **negocio** (mensajes con identificadores `26, 50, 52, 60, 70` etc.). Sí reintentar errores **de red** (timeout, 5xx, ECONNRESET).
- Después de N fallos, marcar como `ERROR_RED` y mandar al cron.

### Contingencia (servicio SRI caído)

- Si el SRI no responde por más de unas horas, igual el comprobante **puede emitirse al cliente** (legalmente válido siempre que se autorice dentro de 72 h).
- Generar RIDE provisional indicando "PENDIENTE DE AUTORIZACIÓN".
- Reenviar automáticamente cuando se restablezca el servicio.
- El RIDE definitivo se envía después con `numeroAutorizacion`.

### Monitoreo

Métricas clave:

- Tasa de comprobantes en `AUTORIZADO` vs `NO_AUTORIZADO` (rolling 24h).
- Tiempo medio desde envío hasta autorización.
- Comprobantes "trabados" en `RECIBIDA` / `EN_PROCESO` por más de 1 h.
- Certificados próximos a vencer (alerta a 30/15/7 días).

---

## 18. Buenas prácticas y errores comunes

### Diseño

- ✅ **Separar responsabilidades**: parser/builder del XML, firmador, cliente SOAP, parser de respuesta. Permite testear cada capa con fixtures.
- ✅ **Almacenar todo evento del SRI** (request enviado, response recibido, timing, errores) en una tabla de auditoría. Es la única forma de explicar al SRI o al cliente qué pasó con un comprobante.
- ✅ **Versionar el XSD y validar localmente** antes de firmar.
- ✅ **Tener fixtures de respuestas reales del SRI** (RECIBIDA, DEVUELTA con cada tipo de error, AUTORIZADO, NO AUTORIZADO) para tests de integración.

### Implementación

- ✅ Generar la clave de acceso **una sola vez** y persistirla antes de cualquier reintento.
- ✅ Calcular impuestos en backend; nunca confiar en totales enviados por el frontend.
- ✅ Decimales: siempre `Number.prototype.toFixed(2)` o equivalente, **nunca** redondeo a string sin control. Evitar `parseFloat` en cadenas.
- ✅ Sanitizar `descripcion` (max 300, sin newlines) → causa el 30% de errores de esquema.
- ✅ Manejar el caso **consumidor final** correctamente (cédula `9999999999999`, razón social `"CONSUMIDOR FINAL"`, dirección no requerida).
- ✅ El XML debe ser **string puro UTF-8 sin BOM**. En Node `Buffer.from(str, 'utf8')`.

### Errores que rompen producción

- ❌ **Hardcodear los endpoints**. Usar config por ambiente (test/prod).
- ❌ **Usar SHA-256 si el SRI rechaza** (algunos certificados antiguos sólo admiten SHA-1). Default seguro: SHA-1; permitir override.
- ❌ **No persistir `numeroAutorizacion`** cuando llega — se vuelve imposible regenerar el RIDE.
- ❌ **Saltarse el secuencial** cuando hay rollback de transacción — usar tabla de "secuenciales quemados" para que el SRI no rechace por discontinuidad si se vuelve a usar.
- ❌ **Confundir `claveAcceso` con `numeroAutorizacion`**: desde 2014 son iguales (49 dígitos), pero **persistirlos como campos separados** porque conceptualmente lo son y futuras versiones podrían diferenciarlos otra vez.
- ❌ **Enviar a producción XML con `ambiente=1`** (pruebas) o viceversa. Las URLs y el campo del XML deben coincidir.
- ❌ **Validar la firma en otro engine** (Java, .NET) y confiar en eso — los XML que pasan en otros engines a veces fallan en xadesjs por whitespace. Validar siempre en el mismo runtime.

### Seguridad

- 🔒 El `.p12` y su passphrase son **credenciales tributarias**. Tratarlas como secretos de máxima sensibilidad.
- 🔒 La passphrase **nunca** en logs.
- 🔒 Cifrar at-rest (KMS, columna encriptada).
- 🔒 Acceso por roles: solo el servicio de firma y administradores designados.
- 🔒 Rotación: cargar el certificado activo en cada firma (no cachear más de N minutos), para soportar revocación inmediata.

---

## 19. Checklist de implementación

### Fase 0 — Setup

- [ ] Obtener certificado `.p12` válido del emisor.
- [ ] Habilitar facturación electrónica del RUC en el portal del SRI.
- [ ] Crear establecimiento y punto de emisión en el SRI (definir `estab`/`ptoEmi`).
- [ ] Descargar los XSD oficiales (factura, NC, ND, retención).
- [ ] Descargar la Ficha Técnica vigente del SRI.

### Fase 1 — Recepción

- [ ] Generación de clave de acceso (49 dígitos + módulo 11).
- [ ] Builder de XML factura V2.1.0 respetando orden XSD.
- [ ] Validación local contra XSD.
- [ ] Parseo de .p12 (extracción de cert y key).
- [ ] Firma XAdES-BES enveloped con SHA-1.
- [ ] Cliente SOAP de recepción (ambiente test).
- [ ] Parser de respuesta de recepción con todos los formatos de mensajes.
- [ ] Persistencia de eventos SRI.

### Fase 2 — Autorización

- [ ] Cliente SOAP de autorización.
- [ ] Parser de respuesta de autorización.
- [ ] Persistencia de `numeroAutorizacion`, `fechaAutorizacion`, XML autorizado.
- [ ] Job de polling para `EN_PROCESO` / `RECIBIDA`.

### Fase 3 — Entrega

- [ ] Generador de RIDE PDF con código de barras de la clave.
- [ ] Almacenamiento de XML + PDF (S3 o equivalente).
- [ ] Envío automático por correo al receptor.

### Fase 4 — Otros comprobantes

- [ ] Nota de crédito (XSD V1.1.0).
- [ ] Nota de débito (XSD V1.0.0).
- [ ] Comprobante de retención (XSD V2.0.0).
- [ ] Guía de remisión (si aplica al negocio).

### Fase 5 — Operación

- [ ] Monitoreo de tasa de autorización.
- [ ] Alertas de certificado próximo a vencer.
- [ ] Dashboard de comprobantes pendientes/devueltos.
- [ ] Migración test → producción (cambiar URLs y `ambiente=2`).

---

## Anexo A — Endpoints y WSDL

### Producción

- Recepción: `https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl`
- Autorización: `https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl`
- Consulta pública: `https://srienlinea.sri.gob.ec/sri-en-linea/SriDocumentosElectronicos-portlet/`

### Certificación / Pruebas

- Recepción: `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl`
- Autorización: `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl`

### Operaciones SOAP

- Recepción: `validarComprobante(xml: base64)` → `RespuestaRecepcionComprobante`
- Autorización: `autorizacionComprobante(claveAccesoComprobante: string)` → `RespuestaAutorizacionComprobante`

---

## Anexo B — Recursos oficiales

- **Página oficial de facturación electrónica del SRI**: https://www.sri.gob.ec/facturacion-electronica
- **Ficha Técnica Comprobantes Electrónicos** (la guía maestra; verificar siempre la versión vigente): se descarga desde la página anterior.
- **Esquemas XSD oficiales**: distribuidos por el SRI; archivos clave:
  - `factura_V2.1.0.xsd`
  - `NotaCredito_V1.1.0.xsd`
  - `NotaDebito_V1.0.0.xsd`
  - `ComprobanteRetencion_V2.0.0.xsd`
  - `GuiaRemision_V_1_1_0.xsd`
- **Librerías recomendadas (Node.js)**:
  - [`xadesjs`](https://github.com/PeculiarVentures/xadesjs) — Firma XAdES.
  - [`node-forge`](https://github.com/digitalbazaar/forge) — Parseo PKCS#12.
  - [`@xmldom/xmldom`](https://github.com/xmldom/xmldom) — DOM parser.
  - [`xpath`](https://github.com/goto100/xpath) — XPath para parsear respuestas.
  - [`pdfmake`](http://pdfmake.org/) o [`pdfkit`](http://pdfkit.org/) — Generación de RIDE.
  - [`bwip-js`](https://github.com/metafloor/bwip-js) — Código de barras.
- **Librerías equivalentes (otras tecnologías)**:
  - Java: Apache Santuario (firma), Bouncy Castle (PKCS12), JAXB (XSD).
  - .NET: `System.Security.Cryptography.Xml`, `XadESnet`.
  - PHP: `robrichards/xmlseclibs`.
  - Python: `signxml`, `xmlsec`.

---

## Glosario

- **CDR** — Constancia de Recepción.
- **codDoc** — Código de tipo de documento (`01`, `04`, `05`, `06`, `07`).
- **Comprobante** — Documento electrónico (factura, NC, ND, retención, guía).
- **Clave de acceso** — Identificador único de 49 dígitos del comprobante.
- **Numero de autorización** — Desde 2014, es igual a la clave de acceso. Antes era un valor distinto.
- **RIDE** — Representación Impresa del Documento Electrónico (PDF para el receptor).
- **RIMPE** — Régimen Simplificado para Emprendedores y Negocios Populares (creado en 2022).
- **RUC** — Registro Único de Contribuyentes (identificador tributario, 13 dígitos).
- **SRI** — Servicio de Rentas Internas (autoridad tributaria de Ecuador).
- **XAdES-BES** — XML Advanced Electronic Signatures — Basic Electronic Signature.

---

_Documento elaborado a partir de la Ficha Técnica de Comprobantes Electrónicos del SRI (esquema offline, v2.32) y los esquemas XSD oficiales vigentes. Última revisión de catálogos y endpoints: 2026-05._
