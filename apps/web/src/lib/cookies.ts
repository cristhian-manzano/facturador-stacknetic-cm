/**
 * Cookie reader for `@facturador/web`.
 *
 * Only used by the CSRF helper. The session cookie itself is `HttpOnly`
 * and unreadable from JS (intentional — SPEC-0010 §10.2). The CSRF cookie
 * is JS-readable by design (double-submit pattern — SPEC-0010 §6.6).
 *
 * Cookie names mirror the API:
 *   - Dev/test: `facturador_csrf`
 *   - Production: `__Host-facturador_csrf`
 *
 * `readCookie` returns the first matching value or `null`. Values are URL-
 * decoded (Express writes the CSRF secret as a base64url string which is
 * safe, but other middleware may add unrelated encoded cookies).
 *
 * Never write to `document.cookie` from here — cookies are server-issued
 * (SPEC-0010 §6.4).
 */

/**
 * Read a cookie by exact name. Returns `null` if the cookie is absent
 * or the value is empty.
 *
 * SSR / Node safety: returns `null` when `document` is undefined so this
 * is safe to call from setup files. Tests that need a specific cookie
 * may use the `__setCookie` test helper below.
 */
export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie;
  if (raw === "") return null;
  const needle = `${name}=`;
  // Split on "; " — RFC 6265 doesn't allow ";" inside cookie values.
  for (const part of raw.split("; ")) {
    if (part.startsWith(needle)) {
      const value = part.slice(needle.length);
      if (value === "") return null;
      try {
        return decodeURIComponent(value);
      } catch {
        // Malformed encoding — surface the raw value rather than crash.
        return value;
      }
    }
  }
  return null;
}

/**
 * Look up the CSRF token written by the API.
 *
 * Prefers the dev/test cookie name first because that's what the API
 * sets when `NODE_ENV !== "production"`. Falls back to the production
 * `__Host-` prefix so a SPA running against a prod API still finds it.
 */
export function getCsrfTokenFromCookie(): string | null {
  return readCookie("facturador_csrf") ?? readCookie("__Host-facturador_csrf");
}
