/**
 * `require-companyId-filter` — ESLint rule that flags Prisma calls on
 * tenant-scoped models whose first argument is a literal `{ where: ... }`
 * object missing a `companyId` key.
 *
 * Rationale (security.md §multi-tenant): every read or write on a
 * tenant-scoped model MUST filter by `companyId` to prevent cross-tenant
 * data leakage. The middleware `requireTenant` populates `req.companyId`
 * but the eventual Prisma call is what actually enforces isolation. This
 * rule catches the easy mistake of pushing a `where: { id }` filter
 * without re-binding the tenant boundary.
 *
 * Models covered (see SPEC-0020/0030/0031/0032):
 *   - Invoice              SPEC-0033 §3 — tenant-scoped invoice draft + emitted docs
 *   - Customer             SPEC-0031 §3 — customer catalog
 *   - Establecimiento      SPEC-0030 §3 — billing locations
 *   - EmissionPoint        SPEC-0030 §3 — per-establecimiento emission points
 *   - Membership           SPEC-0010 §3 — user-tenant association
 *   - AuditLog             SPEC-0006 §4 — append-only tenant trail
 *   - Session              SPEC-0009 §3 — auth sessions are tenant-scoped after switch
 *   - Certificate          SPEC-0020 §3 — encrypted .p12 store
 *   - SriDocument          SPEC-0020 §4 — SRI lifecycle table
 *   - BurnedSecuencial     SPEC-0030 §5 — burned/voided sequence audit
 *   - SecuencialCounter    SPEC-0030 §4 — per-EP counter rows
 *
 * Patterns flagged:
 *
 *   prisma.<model>.findMany({ where: { id: 5 } })      // ✗ missing companyId
 *   prisma.<model>.update({ where: { id }, data: {} }) // ✗ missing companyId
 *   tx.<model>.delete({ where: { id } })               // ✗ same on tx
 *
 * Patterns allowed:
 *
 *   prisma.<model>.findMany({ where: { companyId } })          // ✓
 *   prisma.<model>.findMany({ where: someComputedFilter })     // ✓ (rule can't see inside the binding)
 *   prisma.<model>.create({ data: { ... } })                   // ✓ create has no `where`
 *   // eslint-disable-next-line require-companyId-filter -- reason
 *   prisma.<model>.findMany({ where: { id } })                 // ✓ explicitly opt-out
 *
 * Methods inspected: `findMany`, `findFirst`, `findFirstOrThrow`,
 * `update`, `delete`, `deleteMany`, `updateMany`, `upsert`, `count`,
 * `aggregate`, `groupBy`. `findUnique`/`findUniqueOrThrow` are NOT
 * inspected because they require a unique selector by definition; see
 * the comment on `TENANT_METHODS` below for the rationale.
 *
 * The rule deliberately does NOT inspect computed/spread `where` values
 * (e.g. `where: buildFilter(req)`) — those are escape hatches that lint
 * can't usefully reason about without type info, and tests + the `audit`
 * helper already cover the dynamic cases. Use the disable comment with a
 * `-- reason` if you genuinely need to skip a check.
 *
 * @type {import("eslint").Rule.RuleModule}
 */
const TENANT_MODELS = new Set([
  "invoice",
  "customer",
  "establecimiento",
  "emissionPoint",
  "membership",
  "auditLog",
  "session",
  "certificate",
  "sriDocument",
  "burnedSecuencial",
  "secuencialCounter",
]);

/**
 * Methods we want to inspect. We deliberately EXCLUDE `findUnique` and
 * `findUniqueOrThrow` here because both expect a unique selector (by
 * definition: the primary key or a `@@unique` constraint). ULIDs are
 * globally unique, so a `findUnique({ where: { id } })` cannot leak
 * cross-tenant rows in practice — the worst case is an authenticated
 * caller probing arbitrary IDs, and that surface is already handled at
 * the request level by `requireTenant` returning 404 on cross-tenant
 * detail GETs.
 *
 * Mutation methods (`update`, `delete`, `upsert`) accept unique
 * selectors too, but a mutation by ID alone *is* the high-risk surface
 * for a forgotten tenant binding (an attacker that learns or guesses an
 * ID could mutate it). We therefore keep them in this set even though
 * Prisma's typing nominally allows passing a unique selector. Real
 * call sites must either:
 *
 *   (a) Include `companyId` in the `where` (the usual pattern), or
 *   (b) Use the compound `@@unique([companyId, ...])` selector (the rule
 *       recognises any key name containing `companyId`), or
 *   (c) Add an inline disable with a justifying comment.
 */
const TENANT_METHODS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "update",
  "delete",
  "deleteMany",
  "updateMany",
  "upsert",
  "count",
  "aggregate",
  "groupBy",
]);

const PRISMA_ROOTS = new Set(["prisma", "tx", "db", "trx"]);

/**
 * @param {import("estree").ObjectExpression} obj
 * @returns {boolean}
 */
function whereContainsCompanyId(obj) {
  for (const prop of obj.properties) {
    if (prop.type !== "Property") continue;
    if (prop.computed) continue;
    const keyName =
      prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "Literal"
          ? String(prop.key.value)
          : null;
    if (keyName === "companyId") return true;
    // `AND: [{ companyId }, ...]` and `OR: [{ companyId }, ...]` are
    // legitimate ways to bind the tenant boundary too — accept them.
    if (
      (keyName === "AND" || keyName === "OR") &&
      prop.value.type === "ArrayExpression" &&
      prop.value.elements.some(
        (el) => el !== null && el.type === "ObjectExpression" && whereContainsCompanyId(el),
      )
    ) {
      return true;
    }
    // Prisma compound unique selectors look like
    //   where: { userId_companyId: { userId, companyId } }
    //   where: { companyId_tipoIdentificacion_identificacion: { companyId, ... } }
    // The compound-key NAME embeds the constituent column names, so we
    // accept it when the key name contains `companyId` (case-sensitive)
    // OR when the value object itself contains a `companyId` property.
    if (keyName !== null && /companyId/.test(keyName)) return true;
    if (prop.value.type === "ObjectExpression" && whereContainsCompanyId(prop.value)) {
      return true;
    }
  }
  return false;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require `companyId` filter on Prisma queries against tenant-scoped models to prevent cross-tenant data leakage.",
      recommended: true,
    },
    schema: [],
    messages: {
      missingCompanyId:
        "Prisma `{{root}}.{{model}}.{{method}}({...})` call must filter by `companyId` " +
        "in `where` to prevent cross-tenant data leakage. If this call is intentionally " +
        "scope-free (e.g. a system-level read), add `// eslint-disable-next-line " +
        "require-companyId-filter -- <reason>`.",
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        // Match `<root>.<model>.<method>(...)`.
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        if (callee.object.type !== "MemberExpression") return;
        if (callee.property.type !== "Identifier") return;
        if (callee.object.property.type !== "Identifier") return;
        if (callee.object.object.type !== "Identifier") return;

        const rootName = callee.object.object.name;
        const modelName = callee.object.property.name;
        const methodName = callee.property.name;

        if (!PRISMA_ROOTS.has(rootName)) return;
        if (!TENANT_MODELS.has(modelName)) return;
        if (!TENANT_METHODS.has(methodName)) return;

        // First argument must be a literal object to be inspected. Skip
        // any other shape (computed filter, spread, etc.).
        const arg0 = node.arguments[0];
        if (arg0 === undefined) return;
        if (arg0.type !== "ObjectExpression") return;

        // `create` legitimately has no `where`. We don't track it here,
        // but if a user passes `{ where: ... }` to a create call we don't
        // want to false-positive: only inspect calls whose object has a
        // `where` key. If there's no `where` we skip.
        let whereProp = null;
        for (const prop of arg0.properties) {
          if (prop.type !== "Property" || prop.computed) continue;
          if (prop.key.type === "Identifier" && prop.key.name === "where") {
            whereProp = prop;
            break;
          }
          if (prop.key.type === "Literal" && prop.key.value === "where") {
            whereProp = prop;
            break;
          }
        }
        if (whereProp === null) {
          // `aggregate({ _count: ... })` / `groupBy({ by: [...] })` may
          // omit `where`. They're still tenant-leaking calls if used
          // bare. Treat missing-where as a violation for the methods that
          // semantically *must* filter (read/write). Skip the rest.
          const requiresWhere = methodName !== "create" && methodName !== "upsert";
          if (!requiresWhere) return;
          context.report({
            node,
            messageId: "missingCompanyId",
            data: { root: rootName, model: modelName, method: methodName },
          });
          return;
        }

        // The `where` value must be a literal ObjectExpression for us to
        // inspect it. Computed/spread `where` is an escape hatch.
        if (whereProp.value.type !== "ObjectExpression") return;

        if (!whereContainsCompanyId(whereProp.value)) {
          context.report({
            node,
            messageId: "missingCompanyId",
            data: { root: rootName, model: modelName, method: methodName },
          });
        }
      },
    };
  },
};

export default rule;
