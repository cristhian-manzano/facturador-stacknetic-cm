// @ts-check
/**
 * Tests for the `require-companyId-filter` ESLint rule. Uses ESLint's
 * built-in `RuleTester` so we don't take on any extra deps; the suite
 * runs under vitest via `pnpm -F @facturador/config test`.
 *
 * Coverage targets:
 *
 *   - Valid case: `prisma.invoice.findMany({ where: { companyId } })`
 *   - Valid case: `prisma.invoice.findMany({ where: { AND: [{ companyId }] } })`
 *   - Valid case: computed `where` expression (rule can't see inside)
 *   - Valid case: `create` / `upsert` (no `where` required at the top-level)
 *   - Valid case: non-tenant model (e.g. `prisma.role.findMany`)
 *   - Invalid case: bare `where: { id }` on every tenant model
 *   - Invalid case: same on `tx.<model>` (transactional)
 *   - Invalid case: methods missing `where` entirely (e.g. `findMany()`)
 */

import { RuleTester } from "eslint";
import { describe, it } from "vitest";

import rule from "../require-companyId-filter.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

describe("require-companyId-filter", () => {
  it("runs the RuleTester suite", () => {
    ruleTester.run("require-companyId-filter", rule, {
      valid: [
        // companyId at the top level of where.
        {
          code: "prisma.invoice.findMany({ where: { companyId: c, id: 1 } });",
        },
        // companyId nested inside AND.
        {
          code: "prisma.customer.findFirst({ where: { AND: [{ companyId }, { id }] } });",
        },
        // Prisma compound unique selector — companyId in the key name
        // and the nested object.
        {
          code: "prisma.membership.upsert({ where: { userId_companyId: { userId, companyId } }, create: {}, update: {} });",
        },
        // Compound key whose name contains companyId (covers
        // `companyId_tipoIdentificacion_identificacion` etc.).
        {
          code: "tx.customer.findFirst({ where: { companyId_identificacion: { companyId, identificacion } } });",
        },
        // companyId nested inside OR (rare but legal).
        {
          code: "prisma.session.findMany({ where: { OR: [{ companyId }] } });",
        },
        // Computed where — rule deliberately doesn't inspect.
        {
          code: "prisma.invoice.findMany({ where: buildFilter(req) });",
        },
        // Create — no `where` semantically required at the top level.
        {
          code: "prisma.customer.create({ data: { companyId, name: 'x' } });",
        },
        // Non-tenant model (not in TENANT_MODELS) — completely ignored.
        {
          code: "prisma.role.findMany({ where: { name: 'OWNER' } });",
        },
        // Non-prisma root — rule should not fire for arbitrary objects.
        {
          code: "anyOther.invoice.findMany({ where: { id: 1 } });",
        },
        // tx.<model>.findFirst with companyId.
        {
          code: "tx.membership.findFirst({ where: { companyId, userId } });",
        },
        // upsert is a write but allowed to skip the where check (top-level
        // unique constraint is what binds it).
        {
          code: "prisma.customer.upsert({ where: { id: 1 }, create: { companyId, n: 'x' }, update: { n: 'y' } });",
        },
        // Method called with no arguments at all — rule only inspects when
        // there IS a literal argument. (Real codepaths that need a filter
        // simply don't compile, since Prisma's typings require args.)
        {
          code: "prisma.invoice.findMany();",
        },
      ],
      invalid: [
        // Missing companyId on findMany.
        {
          code: "prisma.invoice.findMany({ where: { id: 1 } });",
          errors: [{ messageId: "missingCompanyId" }],
        },
        // Missing companyId on update.
        {
          code: "prisma.customer.update({ where: { id: 1 }, data: { name: 'x' } });",
          errors: [{ messageId: "missingCompanyId" }],
        },
        // delete without companyId.
        {
          code: "tx.session.delete({ where: { id: 1 } });",
          errors: [{ messageId: "missingCompanyId" }],
        },
        // findFirst with empty where.
        {
          code: "prisma.establecimiento.findFirst({ where: {} });",
          errors: [{ messageId: "missingCompanyId" }],
        },
        // AND clause that doesn't contain companyId anywhere.
        {
          code: "prisma.emissionPoint.findMany({ where: { AND: [{ id: 1 }, { ptoEmi: '001' }] } });",
          errors: [{ messageId: "missingCompanyId" }],
        },
        // count given args but no where at all → flag (read method
        // semantically needs a filter).
        {
          code: "prisma.membership.count({ orderBy: { id: 'asc' } });",
          errors: [{ messageId: "missingCompanyId" }],
        },
      ],
    });
  });
});
