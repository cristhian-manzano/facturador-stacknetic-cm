````md
# Objetivo

Actúa como un Staff/Principal Software Engineer especializado en auditoría técnica, arquitectura, TypeScript/Node.js, monorepos, testing, seguridad, integraciones externas y dominio de facturación electrónica/SRI Ecuador.

Ya ejecuté todos los prompts ubicados en `ai/prompts`, desde `0001` hasta `0043`, sin omitir ninguno. Cada prompt corresponde a una especificación, plan y lista de tareas relacionada en:

- `ai/specs`
- `ai/plans`
- `ai/tasks`
- `ai/context`
- `ai/decisions`
- `docs`

Tu trabajo NO es implementar ni modificar código. Tu trabajo es realizar una revisión técnica exhaustiva y generar un único archivo Markdown de review con hallazgos claros, detallados y accionables.

El resultado esperado es un reporte que permita saber si el proyecto está correctamente implementado, si falta algo, si hay errores de lógica, si las validaciones son suficientes, si los tests cubren lo necesario y si el proyecto está listo para ejecutarse correctamente en un entorno real.

---

# Alcance de la revisión

Debes revisar uno por uno todos los prompts ejecutados, desde el `0001` hasta el `0043`.

Para cada prompt/spec/task debes analizar, como mínimo:

1. El prompt correspondiente en `ai/prompts`.
2. La spec correspondiente en `ai/specs`.
3. El plan correspondiente en `ai/plans`, si existe.
4. Las tasks correspondientes en `ai/tasks`.
5. Reviews previos en `ai/reviews`, si existen.
6. Contexto de dominio en `ai/context`.
7. Decisiones de arquitectura en `ai/decisions`.
8. Documentación completa en `docs`.
9. Archivos reales del codebase relacionados:
   - `apps`
   - `packages`
   - `scripts`
   - configuración raíz
   - migraciones
   - Prisma/schema
   - tests
   - Docker/configuración local
   - CI/lint/typecheck/test scripts, si existen

No asumas que algo está bien solo porque existe un archivo. Debes verificar que lo implementado corresponda realmente con lo especificado.

---

# Reglas estrictas

- No modifiques código.
- No hagas refactors.
- No crees migraciones.
- No cambies archivos existentes excepto para generar el archivo final de review.
- Puedes ejecutar comandos de validación, lectura, inspección y tests.
- Debes revisar lógica, arquitectura, consistencia, cobertura de tests, edge cases y mantenibilidad.
- Si algo no puede validarse por falta de dependencias, entorno, variables de ambiente o servicios externos, debes documentarlo explícitamente.
- Si encuentras una discrepancia entre spec, tasks, plan y código, debes reportarla.
- Si una task está marcada como completada pero no está realmente implementada, repórtalo.
- Si algo está implementado parcialmente, repórtalo como parcial, no como completado.
- Si algo parece funcionar pero no tiene tests suficientes, repórtalo.
- Si algo depende de SRI, debes contrastarlo con la documentación del dominio y docs internas antes de considerarlo correcto.

---

# Validaciones obligatorias

Ejecuta todas las validaciones razonables disponibles en el proyecto.

Además, revisa `package.json`, scripts del monorepo y documentación para identificar comandos adicionales relevantes

No inventes resultados. Para cada comando ejecutado, documenta:

- Comando exacto.
- Resultado.
- Si pasó o falló.
- Errores relevantes.
- Impacto del fallo.
- Si el fallo bloquea o no bloquea la aprobación del proyecto.

Si no puedes ejecutar un comando por limitaciones del entorno, documenta la razón y qué debería ejecutarse manualmente.

---

# Criterios de revisión por cada spec/prompt

Para cada ítem `0001` a `0043`, revisa y reporta:

## 1. Estado general

Clasifica el estado como uno de:

- `Completado correctamente`
- `Completado con observaciones`
- `Implementación parcial`
- `No implementado`
- `No verificable`
- `Bloqueado por errores`

## 2. Evidencia revisada

Incluye los archivos concretos revisados, por ejemplo:

- specs
- tasks
- planes
- código fuente
- tests
- configs
- documentación
- migraciones
- componentes UI
- servicios
- contratos
- schemas
- jobs
- adapters
- clientes externos

## 3. Requisitos esperados

Resume qué exigía la spec/prompt/task.

## 4. Implementación encontrada

Describe qué existe realmente en el codebase.

## 5. Brechas encontradas

Lista todo lo que falte, esté incompleto, incorrecto o no coincida con la spec.

## 6. Validación técnica

Indica cómo se validó:

- tests existentes
- pruebas ejecutadas
- typecheck
- lint
- build
- revisión manual de lógica
- revisión de contratos
- revisión de migraciones
- revisión de integración

## 7. Riesgos

Clasifica riesgos como:

- Crítico
- Alto
- Medio
- Bajo

Explica impacto y escenarios de falla.

## 8. Recomendaciones

Propón acciones concretas para corregir cada problema.

Las recomendaciones deben ser suficientemente específicas para que otro desarrollador pueda implementarlas sin tener que reinterpretar el problema.

---

# Revisión específica de dominio SRI

Debes revisar detalladamente que la lógica SRI esté correctamente implementada según la documentación interna del proyecto.

Antes de evaluar cualquier implementación relacionada con SRI, lee y cruza información de:

- `docs`
- `ai/context/sri-domain.md`
- `ai/context/product.md`
- specs `0020` a `0033`
- cualquier otra documentación o ADR relacionada

Presta especial atención a:

## Clave de acceso

Verifica:

- estructura correcta
- longitud correcta
- composición de campos
- fecha
- tipo de comprobante
- RUC
- ambiente
- serie
- secuencial
- código numérico
- tipo de emisión
- dígito verificador
- algoritmo módulo 11
- casos borde
- tests con fixtures reales o representativos

## XML de factura

Verifica:

- estructura esperada
- campos obligatorios
- formatos
- totales
- impuestos
- descuentos
- identificación del comprador
- infoTributaria
- infoFactura
- detalles
- impuestos por detalle
- totales por impuesto
- redondeo
- escapes XML
- validación contra XSD si aplica
- snapshots o golden files

## Firma XAdES-BES

Verifica:

- manejo de certificados `.p12`
- password de certificado
- extracción segura de clave privada
- canonicalización
- digest
- signature value
- signed properties
- referencias
- namespaces
- compatibilidad esperada con SRI
- manejo seguro de secretos
- tests unitarios/integración razonables

## Clientes SOAP SRI

Verifica:

- endpoints por ambiente
- recepción
- autorización
- timeouts
- retries
- errores SOAP
- respuestas recibida/devuelta
- respuestas autorizada/no autorizada/en procesamiento
- parsing robusto
- logging sin filtrar datos sensibles
- tests con mocks/fixtures

## Ciclo de vida del documento

Verifica:

- estados internos
- transiciones válidas
- persistencia
- idempotencia
- jobs
- reintentos
- errores recuperables/no recuperables
- trazabilidad
- auditoría
- concurrencia
- secuenciales
- consistencia transaccional

## Secuenciación y puntos de emisión

Verifica:

- unicidad de secuenciales
- control por tenant/establishment/emission point
- concurrencia
- transacciones
- rollback
- prevención de duplicados
- tests de condiciones de carrera si aplica

## Orquestación de emisión

Verifica:

- flujo completo de factura:

  1. crear factura
  2. validar datos
  3. generar clave de acceso
  4. construir XML
  5. firmar XML
  6. enviar a recepción
  7. consultar autorización
  8. persistir resultado
  9. exponer estado al frontend

- manejo de fallos en cada etapa
- reintentos
- idempotencia
- observabilidad
- consistencia de base de datos

---

# Revisión de arquitectura y mantenibilidad

Además de verificar cumplimiento de specs, revisa la calidad general del proyecto.

Evalúa:

## Arquitectura

- separación de responsabilidades
- límites entre apps/packages
- dependencia entre capas
- acoplamiento
- cohesión
- patrones usados
- consistencia entre módulos
- escalabilidad futura
- facilidad de extender nuevos comprobantes además de factura

## Código

- claridad
- duplicación
- tipado
- validación de inputs
- errores
- logging
- naming
- estructura de carpetas
- dead code
- TODOs importantes
- código temporal
- casos no manejados

## Seguridad

- manejo de sesiones
- autenticación
- autorización
- RBAC
- multi-tenancy
- aislamiento entre tenants
- secretos
- certificados
- logs con datos sensibles
- validaciones backend
- exposición accidental de información

## Base de datos

- schema Prisma
- relaciones
- constraints
- índices
- unicidad
- migraciones
- consistencia transaccional
- cascades
- timestamps
- soft deletes si aplica
- tenant isolation
- integridad referencial

## Frontend

- flujos de auth
- creación de facturas
- listado/detalle
- manejo de loading/error/empty states
- validación de formularios
- consistencia con contratos backend
- seguridad de rutas
- UX mínima para operación real

## Testing

Evalúa si existen y son suficientes:

- unit tests
- integration tests
- e2e tests
- tests de dominio SRI
- tests de XML
- tests de clave de acceso
- tests de firma
- tests de SOAP clients
- tests de autorización/RBAC
- tests de multi-tenancy
- tests de concurrencia
- fixtures representativos
- mocks adecuados
- cobertura de errores

No consideres “validado” algo que solo fue implementado sin tests o sin ejecución.

---

# Revisión de consistencia entre artefactos AI

Debes verificar consistencia entre:

- `ai/prompts`
- `ai/specs`
- `ai/tasks`
- `ai/plans`
- `ai/reviews`
- código real

Detecta:

- tasks marcadas como hechas pero no implementadas
- specs que piden algo que no existe
- código que implementa algo distinto a la spec
- reviews previas que mencionan issues no corregidos
- archivos faltantes
- nombres inconsistentes
- features implementadas fuera del alcance
- deuda técnica acumulada
- dependencias entre prompts no satisfechas

---

# Formato del archivo final

Genera un único archivo Markdown en:

```txt
ai/reviews/0043-final-full-project-review.md
```

El reporte debe ser ultra detallado y accionable.

Usa esta estructura mínima:

```md
# Final Full Project Review

## 1. Executive Summary

- Estado general del proyecto.
- Si está listo o no para ejecución real.
- Principales bloqueadores.
- Principales riesgos.
- Recomendación final: aprobar, aprobar con cambios, o no aprobar.

## 2. Validation Commands Executed

Tabla con:

| Command | Result | Notes | Blocking |
| ------- | ------ | ----- | -------- |

## 3. Overall Readiness Assessment

Evalúa:

- Functional readiness
- SRI domain readiness
- Test readiness
- Security readiness
- Architecture readiness
- Production readiness

Usa escala:

- Ready
- Mostly ready
- Partially ready
- Not ready
- Not verifiable

## 4. Prompt-by-Prompt Review

Una sección por cada prompt/spec:

### 0001 - Nombre

#### Status

#### Files Reviewed

#### Expected Requirements

#### Implementation Found

#### Validation Performed

#### Findings

#### Risks

#### Required Fixes

#### Recommendation

Repetir hasta `0043`.

## 5. SRI Domain Review

Incluye subsecciones para:

- Clave de acceso
- XML factura
- XAdES-BES
- SOAP clients
- Document lifecycle
- Sequencing
- Invoice emission orchestration
- Error handling
- Idempotency
- SRI environment handling
- Fixtures and tests

## 6. Architecture Review

Incluye:

- strengths
- weaknesses
- coupling issues
- scalability issues
- maintainability issues
- package boundaries
- suggested improvements

## 7. Security Review

Incluye:

- auth/session
- RBAC
- tenant isolation
- certificates/secrets
- logging
- input validation
- frontend/backend authorization consistency

## 8. Database and Data Integrity Review

Incluye:

- schema
- migrations
- constraints
- indexes
- transactions
- consistency
- tenant safety
- sequential numbering

## 9. Testing Review

Incluye:

- tests existentes
- tests faltantes
- gaps de cobertura
- tests críticos requeridos antes de producción
- comandos ejecutados
- resultados

## 10. Critical Blockers

Lista solo bloqueadores críticos que impiden considerar el proyecto listo.

Cada blocker debe tener:

- descripción
- evidencia
- impacto
- fix recomendado
- prioridad

## 11. High Priority Issues

Problemas importantes no necesariamente bloqueantes.

## 12. Medium/Low Priority Issues

Deuda técnica, mejoras y limpieza.

## 13. Recommended Implementation Plan

Propón un plan de corrección ordenado por prioridad:

1. Critical blockers
2. SRI correctness
3. Data integrity
4. Security
5. Tests
6. Architecture cleanup
7. UX/frontend polish

## 14. Final Verdict

Indica claramente:

- ¿Está todo implementado según specs?
- ¿Está validado con tests?
- ¿La lógica SRI parece correcta?
- ¿El proyecto está listo para ejecutarse?
- ¿Qué debe hacerse antes de considerarlo terminado?
```

---

# Nivel de detalle esperado

Sé extremadamente específico.

Mal ejemplo:

> Faltan tests de SRI.

Buen ejemplo:

> Falta un test unitario para `generateAccessKey` que valide el cálculo del dígito verificador con módulo 11 usando un caso conocido de factura. Actualmente existe cobertura para longitud, pero no para composición campo por campo ni para rechazo de RUC inválido. Esto puede permitir claves de acceso formalmente inválidas que fallarían en recepción SRI.

Mal ejemplo:

> Revisar seguridad.

Buen ejemplo:

> El endpoint `POST /invoices` valida autenticación, pero no se encontró evidencia de validación explícita de membership activa del tenant antes de crear la factura. Esto podría permitir que un usuario autenticado cree documentos en un tenant al que no pertenece si conoce el `tenantId`. Se recomienda validar tenant membership en el backend, no solo en UI.

---

# Criterios de aprobación

El proyecto solo debe considerarse listo si:

- Todas las specs `0001` a `0043` están implementadas o justificadamente no aplican.
- Las tasks relevantes están completadas en código real.
- No hay discrepancias críticas entre specs y código.
- `lint`, `typecheck`, `test` y `build` pasan.
- La lógica SRI crítica está implementada y testeada.
- La generación de clave de acceso está cubierta por tests deterministas.
- La generación XML está cubierta por fixtures/snapshots o validación equivalente.
- La firma XAdES-BES tiene validaciones razonables.
- Los clientes SOAP tienen mocks/fixtures y manejo robusto de errores.
- La emisión de facturas es idempotente o tiene mecanismos claros contra duplicados.
- Los secuenciales son seguros ante concurrencia.
- El multi-tenancy está protegido en backend.
- No se filtran secretos, certificados, passwords ni XML sensible en logs.
- El frontend consume contratos reales y maneja estados de error.
- El proyecto puede ejecutarse localmente con instrucciones claras.

Si cualquiera de esos puntos falla, el reporte debe marcar el proyecto como no listo o listo solo con observaciones, según severidad.

---

# Salida esperada

Al finalizar:

1. Crea el archivo:

```txt
ai/reviews/0043-final-full-project-review.md
```

1. No modifiques ningún otro archivo.

2. En tu respuesta final, resume solamente:

- archivo generado
- estado general
- número de blockers críticos
- número de issues altos/medios/bajos
- comandos ejecutados y resultado general
- próximos pasos recomendados

No incluyas todo el reporte en la respuesta final, porque el reporte completo debe estar en el archivo Markdown.

```

```
````
