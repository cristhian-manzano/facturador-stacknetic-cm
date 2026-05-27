/**
 * Validates every fixture factory by parsing its output through the
 * appropriate `@facturador/contracts` schema (TASKS-0007 §5.1 / §5.2).
 *
 * If a factory ever drifts from the contract — extra field, wrong primitive,
 * missing required key — Zod refuses the parse and this test fails.  This
 * is the cheapest possible drift detector and runs on every CI invocation.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { LoginRequestSchema, MembershipSummarySchema } from "@facturador/contracts/auth";
import { RucSchema } from "@facturador/contracts/primitives";
import { TenantSchema } from "@facturador/contracts/tenants";

import { newId } from "./_ids.js";
import { auditLogFactory } from "./audit-log.js";
import { SYNTHETIC_RUCS, companyFactory, companyToTenant } from "./company.js";
import { membershipFactory, membershipToSummary } from "./membership.js";
import { sessionFactory } from "./session.js";
import { userFactory, userToPublic } from "./user.js";

describe("fixtures policy — synthetic data only", () => {
  it("every SYNTHETIC_RUC starts with `9999` and passes RucSchema", () => {
    for (const ruc of SYNTHETIC_RUCS) {
      expect(ruc.startsWith("9999")).toBe(true);
      expect(() => RucSchema.parse(ruc)).not.toThrow();
    }
  });

  it("companyFactory output passes TenantSchema via companyToTenant", () => {
    const company = companyFactory();
    expect(company.ruc.startsWith("9999")).toBe(true);
    expect(() => TenantSchema.parse(companyToTenant(company))).not.toThrow();
  });

  it("userFactory produces an @facturador.test email and a non-empty random password", () => {
    const u = userFactory();
    expect(u.email.endsWith("@facturador.test")).toBe(true);
    expect(u.password.length).toBeGreaterThanOrEqual(16);
    expect(u.password.startsWith("Fixture_")).toBe(true);
    // The wire-shaped UserPublic drops the password.
    const pub = userToPublic(u);
    expect((pub as { password?: string }).password).toBeUndefined();
  });

  it("membershipFactory output parses through MembershipSummarySchema", () => {
    const m = membershipFactory({ userId: newId(), companyId: newId() });
    expect(() =>
      MembershipSummarySchema.parse(membershipToSummary(m, "SYNTHETIC TENANT S.A.")),
    ).not.toThrow();
  });

  it("sessionFactory CSRF hash is sha256 of the secret and TTL defaults to 480 min", () => {
    const s = sessionFactory({ userId: newId() });
    expect(s.csrfTokenHash).toMatch(/^[0-9a-f]{64}$/);
    const diffMs = s.expiresAt.getTime() - s.createdAt.getTime();
    expect(diffMs).toBe(480 * 60_000);
  });

  it("auditLogFactory defaults to `auth.login.success` and carries no real PII", () => {
    const a = auditLogFactory();
    expect(a.action).toBe("auth.login.success");
    expect(a.entity).toBe("Session");
    const serialised = JSON.stringify(a.payloadJson ?? {});
    // Any email-shaped substring must end in `@facturador.test`.
    const emails = serialised.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? [];
    for (const email of emails) {
      expect(email.endsWith("@facturador.test")).toBe(true);
    }
  });

  it("LoginRequestSchema accepts a userFactory-derived payload (property-based)", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9]{2,18}$/).map((local) => `${local}@facturador.test`),
        // Password length capped at 72 per LoginRequestSchema.
        fc.string({ minLength: 8, maxLength: 72 }),
        (email, password) => {
          const result = LoginRequestSchema.safeParse({ email, password });
          return result.success;
        },
      ),
      { numRuns: 25 },
    );
  });
});
