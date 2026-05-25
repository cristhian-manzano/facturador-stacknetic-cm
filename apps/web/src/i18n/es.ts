/**
 * Spanish UI strings for `@facturador/web` (SPEC-0040 §6 / PLAN-0040 §4
 * Phase 6).
 *
 * Single flat table keyed by `<area>.<key>`. The lookup helper supports
 * `{var}` interpolation. We deliberately ship no i18n library for v1 —
 * adding English will introduce one (LinguiJS / i18next) under a future
 * spec.
 *
 * Components MUST import strings from here rather than hard-coding text.
 * Hard-coded text breaks downstream translation; the lint convention in
 * SPEC-0040 §7.3 captures this. Tests assert that core routes render the
 * canonical labels.
 */

const STRINGS = {
  // Application chrome
  "app.name": "Facturador",
  "app.tagline": "Facturación electrónica para Ecuador (SRI)",

  // Layout / nav
  "nav.home": "Inicio",
  "nav.invoices": "Facturas",
  "nav.customers": "Clientes",
  "nav.establecimientos": "Establecimientos",
  "nav.settings": "Configuración",
  "nav.signOut": "Cerrar sesión",
  "nav.tenant.placeholder": "Selecciona empresa",
  "nav.skipToContent": "Saltar al contenido",

  // Auth
  "auth.login.title": "Iniciar sesión",
  "auth.login.lead": "Ingresa con tu correo y contraseña corporativa.",
  "auth.login.email": "Correo electrónico",
  "auth.login.password": "Contraseña",
  "auth.login.submit": "Ingresar",
  "auth.login.submitting": "Ingresando…",
  "auth.login.invalidCredentials": "Credenciales inválidas",
  "auth.login.tooManyAttempts": "Demasiados intentos. Intenta de nuevo en unos minutos.",
  "auth.login.generic": "No pudimos iniciar tu sesión. Intenta de nuevo.",
  "auth.tenantSelect.title": "Selecciona una empresa",
  "auth.tenantSelect.lead": "Elige la empresa con la que deseas trabajar en esta sesión.",
  "auth.tenantSelect.empty": "No tienes empresas asignadas. Solicita acceso a un administrador.",
  "auth.tenantSelect.switchError": "No pudimos cambiar de empresa. Intenta de nuevo.",
  "auth.signOut.confirm": "¿Cerrar la sesión actual?",
  "auth.tenantSwitcher.label": "Cambiar de empresa",
  "auth.tenantSwitcher.current": "Empresa activa",

  // Pages
  "home.title": "Bienvenido",
  "home.lead": "Selecciona una opción en la barra lateral para empezar a trabajar.",

  // Invoices
  "invoice.new.title": "Nueva factura",
  "invoice.edit.title": "Editar borrador",
  "invoice.edit.locked.title": "Esta factura ya fue emitida",
  "invoice.edit.locked.body":
    "No puedes editar una factura emitida. Abre el detalle para ver su estado.",
  "invoice.edit.locked.cta": "Ver detalle",
  "invoice.form.emissionPoint": "Punto de emisión",
  "invoice.form.emissionPoint.placeholder": "Selecciona un punto",
  "invoice.form.fecha": "Fecha de emisión",
  "invoice.form.customer": "Cliente",
  "invoice.form.customer.search": "Buscar cliente (mín. 2 caracteres)",
  "invoice.form.customer.new": "Nuevo cliente",
  "invoice.form.customer.required": "Selecciona o crea un cliente",
  "invoice.form.lines.title": "Líneas",
  "invoice.form.lines.add": "Agregar línea",
  "invoice.form.line.descripcion": "Descripción",
  "invoice.form.line.cantidad": "Cantidad",
  "invoice.form.line.precioUnitario": "Precio unitario",
  "invoice.form.line.descuento": "Descuento",
  "invoice.form.line.iva": "IVA",
  "invoice.form.line.remove": "Quitar línea",
  "invoice.form.payments.title": "Pagos",
  "invoice.form.payments.add": "Agregar pago",
  "invoice.form.payment.formaPago": "Forma de pago",
  "invoice.form.payment.total": "Total",
  "invoice.form.payment.remove": "Quitar pago",
  "invoice.form.payment.mismatch": "Pagos no coinciden con el total",
  "invoice.form.adicionales.title": "Información adicional",
  "invoice.form.adicionales.add": "Agregar campo",
  "invoice.form.adicionales.nombre": "Nombre",
  "invoice.form.adicionales.valor": "Valor",
  "invoice.form.totals.title": "Totales",
  "invoice.form.totals.subtotal": "Subtotal",
  "invoice.form.totals.iva": "IVA",
  "invoice.form.totals.total": "Total",
  "invoice.form.totals.pending": "Calculando…",
  "invoice.form.actions.cancel": "Cancelar",
  "invoice.form.actions.saveDraft": "Guardar borrador",
  "invoice.form.actions.emit": "Emitir",
  "invoice.form.actions.savedHint": "Borrador guardado",
  "invoice.form.error.parseMoney": "Valor numérico inválido",
  "invoice.form.error.required": "Campo requerido",
  "invoice.form.error.generic": "No pudimos guardar el borrador.",
  "invoice.dialog.newCustomer.title": "Nuevo cliente",
  "invoice.dialog.newCustomer.tipoIdentificacion": "Tipo de identificación",
  "invoice.dialog.newCustomer.identificacion": "Identificación",
  "invoice.dialog.newCustomer.razonSocial": "Razón social",
  "invoice.dialog.newCustomer.email": "Email (opcional)",
  "invoice.dialog.newCustomer.telefono": "Teléfono (opcional)",
  "invoice.dialog.newCustomer.direccion": "Dirección (opcional)",
  "invoice.dialog.newCustomer.cancel": "Cancelar",
  "invoice.dialog.newCustomer.submit": "Crear cliente",
  "invoice.dialog.newCustomer.submitting": "Creando…",
  "invoice.dialog.newCustomer.generic": "No pudimos crear el cliente.",
  "invoice.emit.modal.title": "Procesando con el SRI",
  "invoice.emit.modal.submitting": "Enviando al SRI…",
  "invoice.emit.modal.success.authorized": "Factura AUTORIZADA",
  "invoice.emit.modal.success.enProceso": "En proceso. Te llevamos al detalle.",
  "invoice.emit.modal.businessError.title": "El SRI no autorizó la factura",
  "invoice.emit.modal.businessError.cta": "Corregir y reenviar",
  "invoice.emit.modal.networkError.title": "No pudimos contactar al SRI",
  "invoice.emit.modal.networkError.body":
    "Verifica tu conexión e intenta nuevamente. El borrador no se perdió.",
  "invoice.emit.modal.networkError.retry": "Reintentar",
  "invoice.emit.modal.cancel": "Cerrar",
  "invoice.emit.modal.showMore": "Ver más",
  "invoice.emit.modal.showLess": "Ver menos",
  // List page (SPEC-0043)
  "invoice.list.title": "Facturas",
  "invoice.list.create": "Crear factura",
  "invoice.list.refresh": "Refrescar",
  "invoice.list.loadMore": "Cargar más",
  "invoice.list.empty.title": "Aún no tienes facturas",
  "invoice.list.empty.lead":
    "Crea tu primera factura para empezar a emitir comprobantes electrónicos.",
  "invoice.list.error.title": "No pudimos cargar las facturas",
  "invoice.list.error.retry": "Reintentar",
  "invoice.list.loading": "Cargando facturas…",
  "invoice.list.pendingBanner": "{count} facturas pendientes de autorización",
  "invoice.list.pendingBanner.one": "1 factura pendiente de autorización",
  "invoice.list.pendingBanner.refreshAll": "Refrescar todas",
  "invoice.list.pendingBanner.refreshing": "Refrescando…",
  "invoice.list.filters.estado": "Estado",
  "invoice.list.filters.estado.all": "Todos",
  "invoice.list.filters.from": "Desde",
  "invoice.list.filters.to": "Hasta",
  "invoice.list.filters.q": "Buscar",
  "invoice.list.filters.q.placeholder": "Cliente o clave de acceso",
  "invoice.list.filters.clear": "Limpiar filtros",
  "invoice.list.col.fecha": "Fecha",
  "invoice.list.col.cliente": "Cliente",
  "invoice.list.col.estabPto": "Estab-Pto-Sec",
  "invoice.list.col.total": "Total",
  "invoice.list.col.estado": "Estado",
  "invoice.list.col.sriEstado": "Estado SRI",
  "invoice.list.col.acciones": "Acciones",
  "invoice.list.row.openDetail": "Ver detalle",
  "invoice.estado.BORRADOR": "Borrador",
  "invoice.estado.EMITIDO": "Emitida",
  "invoice.estado.ANULADO": "Anulada",
  "invoice.sriEstado.PENDIENTE": "Pendiente",
  "invoice.sriEstado.FIRMADO": "Firmada",
  "invoice.sriEstado.ENVIADO": "Enviada",
  "invoice.sriEstado.RECIBIDA": "Recibida",
  "invoice.sriEstado.EN_PROCESO": "En proceso",
  "invoice.sriEstado.AUTORIZADO": "Autorizada",
  "invoice.sriEstado.NO_AUTORIZADO": "No autorizada",
  "invoice.sriEstado.DEVUELTA": "Devuelta",
  "invoice.sriEstado.ERROR_RED": "Error de red",
  "invoice.sriEstado.ERROR_BUILD": "Error en construcción",
  "invoice.sriEstado.none": "—",
  // Detail page (SPEC-0043)
  "invoice.detail.loading": "Cargando factura…",
  "invoice.detail.error.title": "No pudimos cargar la factura",
  "invoice.detail.error.retry": "Reintentar",
  "invoice.detail.header.estado": "Estado",
  "invoice.detail.header.claveAcceso": "Clave de acceso",
  "invoice.detail.header.claveAcceso.copy": "Copiar clave",
  "invoice.detail.header.claveAcceso.copied": "Copiada",
  "invoice.detail.header.claveAcceso.copyError": "No se pudo copiar",
  "invoice.detail.header.numeroAutorizacion": "Número de autorización",
  "invoice.detail.header.fechaAutorizacion": "Fecha de autorización",
  "invoice.detail.header.ambiente": "Ambiente",
  "invoice.detail.header.ambiente.1": "Pruebas",
  "invoice.detail.header.ambiente.2": "Producción",
  "invoice.detail.header.polling": "Sincronizando con SRI…",
  "invoice.detail.customer.title": "Cliente",
  "invoice.detail.customer.razonSocial": "Razón social",
  "invoice.detail.customer.identificacion": "Identificación",
  "invoice.detail.customer.email": "Email",
  "invoice.detail.customer.telefono": "Teléfono",
  "invoice.detail.customer.direccion": "Dirección",
  "invoice.detail.lines.title": "Líneas",
  "invoice.detail.lines.descripcion": "Descripción",
  "invoice.detail.lines.cantidad": "Cantidad",
  "invoice.detail.lines.precioUnitario": "Precio unitario",
  "invoice.detail.lines.descuento": "Descuento",
  "invoice.detail.lines.subtotal": "Subtotal",
  "invoice.detail.totals.title": "Totales",
  "invoice.detail.totals.subtotal": "Subtotal",
  "invoice.detail.totals.iva": "IVA",
  "invoice.detail.totals.total": "Total",
  "invoice.detail.payments.title": "Pagos",
  "invoice.detail.payments.formaPago": "Forma de pago",
  "invoice.detail.payments.total": "Total",
  "invoice.detail.timeline.title": "Eventos SRI",
  "invoice.detail.timeline.empty": "Sin eventos registrados",
  "invoice.detail.timeline.duration": "{ms} ms",
  "invoice.detail.actions.title": "Acciones",
  "invoice.detail.actions.retryEmit": "Reintentar emisión",
  "invoice.detail.actions.edit": "Editar",
  "invoice.detail.actions.delete": "Eliminar",
  "invoice.detail.actions.delete.confirm":
    "¿Eliminar el borrador? Esta acción no se puede deshacer.",
  "invoice.detail.actions.reissue": "Reissue como nuevo borrador",
  "invoice.detail.actions.refresh": "Sincronizar con SRI",
  "invoice.detail.actions.refreshing": "Sincronizando…",
  "invoice.detail.actions.downloadXml": "Descargar XML autorizado",
  "invoice.detail.actions.printRide": "Imprimir RIDE",
  "invoice.detail.actions.comingSoon": "Próximamente",
  "invoice.detail.actions.error.generic": "No pudimos completar la acción.",
  // Errors
  "forbidden.title": "Acceso denegado",
  "forbidden.body":
    "No tienes permisos para ver esta sección. Si crees que es un error, contacta al administrador de tu empresa.",
  "forbidden.back": "Volver al inicio",
  "notFound.title": "Página no encontrada",
  "notFound.body": "La página que buscas no existe o fue movida.",
  "error.boundary.title": "Algo salió mal",
  "error.boundary.body": "Ocurrió un error inesperado. Recarga la página para continuar.",
  "error.network": "No se pudo contactar al servidor.",
  "error.csrf": "Sesión expirada por seguridad. Inicia sesión nuevamente.",
  "error.unauthorized": "Tu sesión ha expirado. Inicia sesión nuevamente.",
} as const;

export type I18nKey = keyof typeof STRINGS;

/**
 * Resolve a string by key with optional `{var}` interpolation.
 *
 *   t("nav.home")                   // "Inicio"
 *   t("auth.login.submit")          // "Ingresar"
 *
 * Falls back to the literal key when missing (defensive — unknown keys
 * are easier to spot in the UI than rendering `undefined`).
 */
export function t(key: I18nKey, params?: Readonly<Record<string, string | number>>): string {
  // Defensive lookup via `Record<string, string>` index — `key: I18nKey`
  // means the value is statically known to exist, but accepting unknown
  // keys defensively keeps the helper safe if a future caller casts.
  const table = STRINGS as Readonly<Record<string, string>>;
  const template = table[key] ?? key;
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}
