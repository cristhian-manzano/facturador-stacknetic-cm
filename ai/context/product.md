## What is being built

An electronic invoicing platform for Ecuador's tax authority (SRI) under the **offline scheme**. Four supported electronic receipts:

- Factura (invoice).
- Nota de crédito (credit note).
- Nota de débito (debit note).
- Comprobante de retención (withholding receipt).

The product must let Ecuadorian companies issue, sign, send and track these receipts end-to-end.

## Users

- **Empresas emisoras** (issuing companies): create and send receipts, manage catalogs, consult tax status.
- **Contadores** (accountants): operate on behalf of one or several companies, consume reports.
- **Operadores** (clerks): day-to-day emission.

These personas imply multi-tenant from day one: one deployment must serve many companies, with strict data isolation. See [security.md](./security.md).

## Out of scope (explicitly)

- Tax advice, accounting rules beyond what SRI validations require.
- Payroll, electronic payments, banking integrations.
- Non-Ecuadorian tax regimes.
- Esquema en línea (online scheme) — only the offline scheme is in scope.

## Success signals

- A company can emit the four document types and reach `AUTORIZADO` status reliably.
- SRI Core can be consumed independently by an external integrator without dragging in product logic.
- New SRI technical-sheet versions can be rolled out touching only SRI Core.
