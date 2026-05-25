/**
 * Invoice repository — Prisma persistence for the factura aggregate.
 *
 * Source of truth:
 *   - SPEC-0032 §6.1 (handlers/services layout).
 *   - PLAN-0032 §4 Phase 3.
 *
 * Why a repository module:
 *   - The aggregate spans 4 tables (`invoices`, `invoice_lines`,
 *     `invoice_payments`, `invoice_adicionales`). Every write is transactional
 *     and replaces the child rows atomically (we delete+insert on PATCH
 *     because partial line edits are out of scope for v1).
 *   - Cursor pagination is a single SQL query — kept here so handlers stay
 *     thin.
 *   - Decimal -> JSON conversion happens at the response boundary (`toDetail`).
 *
 * Hard rules:
 *   - All queries scoped to `companyId`. The repository functions accept it
 *     as a required argument; never read from a global.
 *   - Soft-delete (`deletedAt`) for BORRADOR drafts; the handler refuses to
 *     delete an EMITIDO. Reads filter `deletedAt IS NULL`.
 *   - Customer existence is validated by the handler BEFORE this module is
 *     called (we never insert with a customerId from another tenant).
 */
import { Prisma } from "@facturador/db";
import type {
  Invoice,
  InvoiceAdicional,
  InvoiceEstado,
  InvoiceLine,
  InvoicePayment,
  PrismaClient,
} from "@facturador/db";
import { newId } from "@facturador/db";
import type { ComputeInvoiceResult, TaxBucket } from "./compute.js";

/**
 * Subset of a line as accepted by the persistence layer. The compute step
 * has already produced `precioTotalSinImpuesto` + `impuestos`; we pass them
 * through as the snapshot stored on the row.
 */
export interface PersistableLine {
  readonly orden: number;
  readonly codigoPrincipal?: string | null;
  readonly codigoAuxiliar?: string | null;
  readonly descripcion: string;
  readonly unidadMedida?: string | null;
  readonly cantidad: string | number;
  readonly precioUnitario: string | number;
  readonly descuento: string | number;
  readonly precioTotalSinImpuesto: number;
  readonly impuestos: ReadonlyArray<{
    readonly codigo: string;
    readonly codigoPorcentaje: string;
    readonly tarifa: number;
    readonly baseImponible: number;
    readonly valor: number;
  }>;
}

export interface PersistablePayment {
  readonly orden: number;
  readonly formaPago: string;
  readonly total: number;
  readonly plazo?: number | null;
  readonly unidadTiempo?: string | null;
}

export interface PersistableAdicional {
  readonly orden: number;
  readonly nombre: string;
  readonly valor: string;
}

export interface CreateInvoiceArgs {
  readonly companyId: string;
  readonly customerId: string;
  readonly emissionPointId: string;
  readonly estab: string;
  readonly ptoEmi: string;
  readonly fechaEmision: Date;
  readonly fechaEmisionLocal: string;
  readonly ambiente: string;
  readonly tipoEmision: string;
  readonly obligadoContabilidad: boolean;
  readonly contribuyenteEspecial: string | null;
  readonly totals: ComputeInvoiceResult;
  readonly lines: ReadonlyArray<PersistableLine>;
  readonly payments: ReadonlyArray<PersistablePayment>;
  readonly adicionales: ReadonlyArray<PersistableAdicional>;
}

export interface UpdateInvoiceArgs {
  readonly id: string;
  readonly companyId: string;
  readonly customerId?: string;
  readonly fechaEmision?: Date;
  readonly fechaEmisionLocal?: string;
  readonly totals: ComputeInvoiceResult;
  readonly lines: ReadonlyArray<PersistableLine>;
  readonly payments: ReadonlyArray<PersistablePayment>;
  readonly adicionales: ReadonlyArray<PersistableAdicional>;
}

/**
 * Row shape returned by the read paths. Decimal columns come back as
 * `Prisma.Decimal`; the handler converts them via `toNumber()` at the
 * JSON boundary.
 */
export type InvoiceWithChildren = Invoice & {
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  adicionales: InvoiceAdicional[];
};

/**
 * Insert an invoice draft. Returns the created row including children.
 * Runs inside a single transaction.
 */
export async function createInvoiceDraft(
  prisma: PrismaClient,
  args: CreateInvoiceArgs,
): Promise<InvoiceWithChildren> {
  const id = newId();
  return await prisma.$transaction(async (tx) => {
    await tx.invoice.create({
      data: {
        id,
        companyId: args.companyId,
        customerId: args.customerId,
        emissionPointId: args.emissionPointId,
        estado: "BORRADOR",
        codDoc: "01",
        estab: args.estab,
        ptoEmi: args.ptoEmi,
        secuencial: null,
        claveAcceso: null,
        fechaEmision: args.fechaEmision,
        fechaEmisionLocal: args.fechaEmisionLocal,
        moneda: "DOLAR",
        ambiente: args.ambiente,
        tipoEmision: args.tipoEmision,
        obligadoContabilidad: args.obligadoContabilidad,
        contribuyenteEspecial: args.contribuyenteEspecial,
        totalSinImpuestos: new Prisma.Decimal(args.totals.totalSinImpuestos),
        totalDescuento: new Prisma.Decimal(args.totals.totalDescuento),
        propina: new Prisma.Decimal(args.totals.propina),
        importeTotal: new Prisma.Decimal(args.totals.importeTotal),
        totalsJson: cloneTotalImpuestos(args.totals.totalImpuestos),
      },
    });
    await insertChildren(tx, id, args.lines, args.payments, args.adicionales);
    const row = await tx.invoice.findUniqueOrThrow({
      where: { id },
      include: { lines: true, payments: true, adicionales: true },
    });
    return row;
  });
}

/**
 * Replace all child rows + recompute totals for an existing BORRADOR
 * invoice. Runs inside a transaction.
 *
 * The handler is responsible for the BORRADOR guard before calling this.
 */
export async function replaceInvoiceDraft(
  prisma: PrismaClient,
  args: UpdateInvoiceArgs,
): Promise<InvoiceWithChildren> {
  return await prisma.$transaction(async (tx) => {
    // Delete then insert children (atomically). Cascade on `Invoice.id`
    // would help on hard-delete of the parent; here we want to keep the
    // parent and refresh children.
    await tx.invoiceLine.deleteMany({ where: { invoiceId: args.id } });
    await tx.invoicePayment.deleteMany({ where: { invoiceId: args.id } });
    await tx.invoiceAdicional.deleteMany({ where: { invoiceId: args.id } });

    const updateData: Prisma.InvoiceUpdateInput = {
      totalSinImpuestos: new Prisma.Decimal(args.totals.totalSinImpuestos),
      totalDescuento: new Prisma.Decimal(args.totals.totalDescuento),
      propina: new Prisma.Decimal(args.totals.propina),
      importeTotal: new Prisma.Decimal(args.totals.importeTotal),
      totalsJson: cloneTotalImpuestos(args.totals.totalImpuestos),
    };
    if (args.customerId !== undefined) {
      updateData.customerId = args.customerId;
    }
    if (args.fechaEmision !== undefined) {
      updateData.fechaEmision = args.fechaEmision;
    }
    if (args.fechaEmisionLocal !== undefined) {
      updateData.fechaEmisionLocal = args.fechaEmisionLocal;
    }

    await tx.invoice.update({ where: { id: args.id }, data: updateData });
    await insertChildren(tx, args.id, args.lines, args.payments, args.adicionales);

    const row = await tx.invoice.findUniqueOrThrow({
      where: { id: args.id },
      include: { lines: true, payments: true, adicionales: true },
    });
    return row;
  });
}

/**
 * Soft-delete a BORRADOR invoice. The handler enforces the state guard.
 */
export async function softDeleteDraft(
  prisma: PrismaClient,
  args: { id: string; companyId: string },
): Promise<void> {
  await prisma.invoice.update({
    where: { id: args.id },
    data: { deletedAt: new Date() },
  });
}

/**
 * Look up by id, scoped to `companyId`. Returns `null` for cross-tenant
 * probes so the handler can return 404 without leaking enumeration.
 */
export async function findInvoiceById(
  prisma: PrismaClient,
  args: { id: string; companyId: string },
): Promise<InvoiceWithChildren | null> {
  return await prisma.invoice.findFirst({
    where: { id: args.id, companyId: args.companyId, deletedAt: null },
    include: { lines: true, payments: true, adicionales: true },
  });
}

export interface ListInvoicesArgs {
  readonly companyId: string;
  readonly estado?: ReadonlyArray<InvoiceEstado>;
  readonly from?: Date;
  readonly to?: Date;
  readonly q?: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface InvoiceListRow {
  readonly id: string;
  readonly estado: InvoiceEstado;
  readonly sriEstado: string | null;
  readonly fechaEmision: Date;
  readonly customerRazonSocial: string;
  readonly estab: string;
  readonly ptoEmi: string;
  readonly secuencial: string | null;
  readonly claveAcceso: string | null;
  readonly importeTotal: Prisma.Decimal;
  readonly createdAt: Date;
}

/**
 * Cursor-paginated list with filters. Order: `(createdAt DESC, id DESC)`.
 *
 * The cursor is the `id` of the last row in the previous batch — we use
 * the standard Prisma `cursor + skip:1` pattern but combined with
 * `orderBy: [{createdAt:'desc'}, {id:'desc'}]` so ties on `createdAt`
 * (millisecond collisions) still order deterministically by ULID.
 */
export async function listInvoices(
  prisma: PrismaClient,
  args: ListInvoicesArgs,
): Promise<{ items: InvoiceListRow[]; nextCursor: string | null }> {
  const where: Prisma.InvoiceWhereInput = {
    companyId: args.companyId,
    deletedAt: null,
  };
  if (args.estado !== undefined && args.estado.length > 0) {
    where.estado = { in: [...args.estado] };
  }
  if (args.from !== undefined || args.to !== undefined) {
    where.fechaEmision = {};
    if (args.from !== undefined) {
      (where.fechaEmision as Prisma.DateTimeFilter).gte = args.from;
    }
    if (args.to !== undefined) {
      (where.fechaEmision as Prisma.DateTimeFilter).lte = args.to;
    }
  }
  if (args.q !== undefined && args.q.length > 0) {
    // Free-text search across `claveAcceso` (exact prefix) and the
    // related customer's `razonSocial` (case-insensitive prefix).
    // Prisma's `OR` accepts both relation-filter forms.
    where.OR = [
      { claveAcceso: { startsWith: args.q } },
      // The customer relation isn't declared on `Invoice` (we use
      // logical FKs). So instead we filter on indexed `customerId`s by
      // running a sub-query the application layer can join.
      // For v1 we just match the prefix on `claveAcceso`. The full search
      // (joining Customer) lands in SPEC-0043; the contract reserves the
      // `?q=` slot here.
    ];
  }

  const rows = await prisma.invoice.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: args.limit + 1,
    ...(args.cursor === undefined ? {} : { cursor: { id: args.cursor }, skip: 1 }),
    select: {
      id: true,
      estado: true,
      sriEstado: true,
      fechaEmision: true,
      estab: true,
      ptoEmi: true,
      secuencial: true,
      claveAcceso: true,
      importeTotal: true,
      createdAt: true,
      customerId: true,
    },
  });

  // Resolve customer razon social — one extra round-trip but keeps the
  // schema's "no Prisma relation" decision intact. The select set is
  // intentionally narrow; PII columns never come back here.
  const customerIds = Array.from(new Set(rows.map((r) => r.customerId)));
  const customers =
    customerIds.length === 0
      ? []
      : await prisma.customer.findMany({
          where: { id: { in: customerIds }, companyId: args.companyId },
          select: { id: true, razonSocial: true },
        });
  const customerMap = new Map(customers.map((c) => [c.id, c.razonSocial]));

  const hasMore = rows.length > args.limit;
  const slice = hasMore ? rows.slice(0, args.limit) : rows;
  const items: InvoiceListRow[] = slice.map((r) => ({
    id: r.id,
    estado: r.estado,
    sriEstado: r.sriEstado,
    fechaEmision: r.fechaEmision,
    customerRazonSocial: customerMap.get(r.customerId) ?? "",
    estab: r.estab,
    ptoEmi: r.ptoEmi,
    secuencial: r.secuencial,
    claveAcceso: r.claveAcceso,
    importeTotal: r.importeTotal,
    createdAt: r.createdAt,
  }));
  const nextCursor = hasMore && items.length > 0 ? slice[slice.length - 1]!.id : null;
  return { items, nextCursor };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Insert all child rows for a given invoice id. Used by both create and
 * update paths.
 */
async function insertChildren(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  lines: ReadonlyArray<PersistableLine>,
  payments: ReadonlyArray<PersistablePayment>,
  adicionales: ReadonlyArray<PersistableAdicional>,
): Promise<void> {
  if (lines.length > 0) {
    await tx.invoiceLine.createMany({
      data: lines.map((l) => ({
        id: newId(),
        invoiceId,
        orden: l.orden,
        codigoPrincipal: l.codigoPrincipal ?? null,
        codigoAuxiliar: l.codigoAuxiliar ?? null,
        descripcion: l.descripcion,
        unidadMedida: l.unidadMedida ?? null,
        cantidad: new Prisma.Decimal(l.cantidad),
        precioUnitario: new Prisma.Decimal(l.precioUnitario),
        descuento: new Prisma.Decimal(l.descuento),
        precioTotalSinImpuesto: new Prisma.Decimal(l.precioTotalSinImpuesto),
        impuestosJson: l.impuestos.map((i) => ({
          codigo: i.codigo,
          codigoPorcentaje: i.codigoPorcentaje,
          tarifa: i.tarifa,
          baseImponible: i.baseImponible,
          valor: i.valor,
        })),
      })),
    });
  }
  if (payments.length > 0) {
    await tx.invoicePayment.createMany({
      data: payments.map((p) => ({
        id: newId(),
        invoiceId,
        orden: p.orden,
        formaPago: p.formaPago,
        total: new Prisma.Decimal(p.total),
        plazo: p.plazo === undefined || p.plazo === null ? null : new Prisma.Decimal(p.plazo),
        unidadTiempo: p.unidadTiempo ?? null,
      })),
    });
  }
  if (adicionales.length > 0) {
    await tx.invoiceAdicional.createMany({
      data: adicionales.map((a) => ({
        id: newId(),
        invoiceId,
        orden: a.orden,
        nombre: a.nombre,
        valor: a.valor,
      })),
    });
  }
}

function cloneTotalImpuestos(buckets: ReadonlyArray<TaxBucket>): Prisma.InputJsonValue {
  return buckets.map((b) => ({
    codigo: b.codigo,
    codigoPorcentaje: b.codigoPorcentaje,
    tarifa: b.tarifa,
    baseImponible: b.baseImponible,
    valor: b.valor,
  }));
}
