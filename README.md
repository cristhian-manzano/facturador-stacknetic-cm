# facturador-stacknetic-cm

Sistema de facturación electrónica para el **Servicio de Rentas Internas (SRI)** de Ecuador.

> Referencia oficial: [sri.gob.ec/facturacion-electronica](https://www.sri.gob.ec/facturacion-electronica)

## Misión

Proveer una plataforma completa de facturación electrónica que cumpla con el esquema offline del SRI (factura, nota de crédito, nota de débito, comprobante de retención), permitiendo a empresas ecuatorianas emitir, firmar y autorizar comprobantes de forma ágil y confiable.

## Meta

Construir una solución modular cuyos componentes puedan evolucionar y comercializarse de forma independiente — tanto como sistema de facturación end-to-end para clientes finales, como en forma de API pública para integradores que solo necesiten la capa de comunicación con el SRI.

## Estructura del proyecto

El repositorio agrupa **3 proyectos independientes** que se despliegan y escalan por separado:

### 1. Web — Aplicación de facturación (frontend)

Interfaz visual del sistema de facturación. Consumida por usuarios finales (empresas, contadores, operadores). Consume a la API de negocio.

### 2. API — Lógica de negocio

Backend del sistema de facturación. Contiene los módulos del producto (clientes, productos, inventario, emisión, reportería, etc.) y toda la lógica de negocio específica de la plataforma. Delega la integración con el SRI al SRI API Core.

### 3. SRI API Core — Facilitador SRI

Proxy/facilitador especializado en la integración con el SRI. Se ocupa exclusivamente de:

- Armar los XMLs conforme a la ficha técnica del esquema offline del SRI.
- Firmar electrónicamente los comprobantes.
- Enviar y consultar autorización ante los web services del SRI.
- Manejar reintentos, contingencia y estados de los comprobantes.

Es consumido por la API (2), y está diseñado para poder ofrecerse a futuro como **API pública independiente** para clientes que solo requieran la integración SRI sin el sistema de facturación completo.

## ¿Por qué separarlos?

Mantener el SRI Core aislado de la lógica de negocio permite:

- Reutilizarlo como producto independiente (API como servicio).
- Evolucionar la lógica SRI (cambios de esquema, versiones de ficha técnica) sin tocar el sistema de facturación.
- Desplegar y escalar cada capa según su perfil de carga.

## Documentación SRI

Referencias oficiales del SRI (ficha técnica y ejemplos XML) en [docs/sri/](docs/sri/).

---

> Este README se irá ampliando con información técnica (stack, setup, arquitectura, deployment) a medida que avance el proyecto.
