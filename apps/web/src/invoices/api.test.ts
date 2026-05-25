/**
 * Unit tests for the new API wrappers added in SPEC-0043.
 *
 * Covers `buildInvoiceListSearchParams` exhaustively (it powers both
 * the URL and the `?` query that the API receives). The wire calls
 * themselves are covered by the integration tests.
 */
import { describe, expect, it } from "vitest";

import { buildInvoiceListSearchParams, ReissueInvoiceResponseSchema } from "./api.js";

describe("buildInvoiceListSearchParams", () => {
  it("returns empty params for empty filters", () => {
    expect(buildInvoiceListSearchParams({}).toString()).toBe("");
  });

  it("serialises a single estado", () => {
    expect(buildInvoiceListSearchParams({ estado: ["EMITIDO"] }).toString()).toBe("estado=EMITIDO");
  });

  it("serialises multiple estados via repeated params", () => {
    expect(
      buildInvoiceListSearchParams({
        estado: ["BORRADOR", "EMITIDO"],
      }).toString(),
    ).toBe("estado=BORRADOR&estado=EMITIDO");
  });

  it("serialises from + to + q + cursor + limit", () => {
    expect(
      buildInvoiceListSearchParams({
        from: "2026-01-01",
        to: "2026-12-31",
        q: "ACME",
        cursor: "abc",
        limit: 50,
      }).toString(),
    ).toBe("from=2026-01-01&to=2026-12-31&q=ACME&cursor=abc&limit=50");
  });

  it("drops empty-string fields (defensive against UI-side leaks)", () => {
    expect(buildInvoiceListSearchParams({ q: "", from: "" }).toString()).toBe("");
  });
});

describe("ReissueInvoiceResponseSchema", () => {
  it("accepts { newInvoiceId }", () => {
    expect(() =>
      ReissueInvoiceResponseSchema.parse({ newInvoiceId: "01HX1234567890ABCDEFGHJKMN" }),
    ).not.toThrow();
  });

  it("rejects an empty id", () => {
    expect(ReissueInvoiceResponseSchema.safeParse({ newInvoiceId: "" }).success).toBe(false);
  });
});
