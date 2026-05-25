# `apps/api` test fixtures

Synthetic-only fixture factories for `@facturador/api` tests.

## Hard rules

1. **RUCs** must start with `9999` and pass the RUC-schema checksum. Use one of
   the values in `SYNTHETIC_RUCS` (`company.ts`) or compute additional valid
   `9999...` RUCs offline. Real Ecuadorian RUCs — yours or anyone else's —
   are forbidden in this directory.
2. **Emails** must end in `@facturador.test`. This domain is reserved by the
   project and is not routable.
3. **Passwords** in fixtures use `Fixture_${randomBytes(8).toString("hex")}`.
   Never check a production-looking password in. Tests that exercise login
   compute argon2 hashes from this value at runtime — the fixture never
   persists a pre-baked hash.
4. **Customer / claveAcceso / SRI XML** payloads must NEVER appear in a fixture.
   The closest we get is the `STUB_CLAVE_ACCESO` constant used by the MSW
   handler in `test/msw/sri-handlers.ts`, which encodes a synthetic 9999 RUC.
5. **Audit log payload JSON** in fixtures uses identifiers built by other
   fixtures (Company/User IDs minted by `newId()`); it must not contain
   anything that looks like a real claim, message, or external token.

## Why factories instead of static JSON?

- A factory call returns a fresh `id` each time — tests can run in parallel
  inside the same per-test schema without colliding.
- Overrides surface intent (`companyFactory({ ruc: SYNTHETIC_RUCS[1] })`)
  better than editing JSON files.
- Type-safe — the factory output matches the Prisma model.

## Pattern

```ts
import { companyFactory } from "./company.js";
import { userFactory } from "./user.js";
import { membershipFactory } from "./membership.js";

const company = companyFactory();
const user = userFactory();
const membership = membershipFactory({ userId: user.id, companyId: company.id });

await prisma.company.create({ data: company });
await prisma.user.create({ data: { ...user, passwordHash: hashed(user.password) } });
await prisma.membership.create({ data: membership });
```

`hashed()` is a project-local helper (see SPEC-0010 for the production wrapper).
Each fixture is a plain function; no mutable state leaks between calls.
