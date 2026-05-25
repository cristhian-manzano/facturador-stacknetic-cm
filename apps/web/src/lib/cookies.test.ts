/**
 * `readCookie` / `getCsrfTokenFromCookie` unit tests.
 *
 * jsdom permits `document.cookie` writes for non-HttpOnly cookies so we
 * can exercise the parser without spinning up a real browser.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getCsrfTokenFromCookie, readCookie } from "./cookies.js";

function clearCookies(): void {
  for (const c of document.cookie.split("; ")) {
    const [k] = c.split("=");
    if (k !== undefined && k.length > 0) {
      document.cookie = `${k}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

beforeEach(clearCookies);
afterEach(clearCookies);

describe("readCookie", () => {
  it("returns null when the cookie is absent", () => {
    expect(readCookie("nonexistent")).toBeNull();
  });

  it("returns the value when the cookie is present", () => {
    document.cookie = "foo=bar; path=/";
    expect(readCookie("foo")).toBe("bar");
  });

  it("returns null when the cookie value is empty", () => {
    document.cookie = "foo=; path=/";
    expect(readCookie("foo")).toBeNull();
  });

  it("URL-decodes the value", () => {
    document.cookie = "encoded=%20space%2B; path=/";
    expect(readCookie("encoded")).toBe(" space+");
  });

  it("ignores look-alike prefixes", () => {
    document.cookie = "facturador_csrf_other=wrong; path=/";
    document.cookie = "facturador_csrf=right; path=/";
    expect(readCookie("facturador_csrf")).toBe("right");
  });
});

describe("getCsrfTokenFromCookie", () => {
  it("prefers the dev/test name when present", () => {
    document.cookie = "facturador_csrf=dev-token; path=/";
    expect(getCsrfTokenFromCookie()).toBe("dev-token");
  });

  it("returns null when neither cookie is set", () => {
    expect(getCsrfTokenFromCookie()).toBeNull();
  });

  // The `__Host-` fallback is asserted via a mocked `document.cookie` getter
  // because jsdom (on `http://localhost`) silently drops cookies whose name
  // starts with `__Host-` — the spec requires Secure + the page must be HTTPS.
  it("falls back to the __Host- prefixed cookie name when the dev name is missing", () => {
    const originalGetter = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get() {
        return "__Host-facturador_csrf=prod-token";
      },
    });
    try {
      expect(getCsrfTokenFromCookie()).toBe("prod-token");
    } finally {
      if (originalGetter) {
        Object.defineProperty(document, "cookie", originalGetter);
      }
    }
  });
});
