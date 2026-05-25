/**
 * ULID generator for fixtures.
 *
 * Re-exports `ulid()` from the `ulid` package so fixture callers don't need
 * to know which dependency owns ID generation.  Kept under `fixtures/` so
 * we can swap in a deterministic generator later (e.g. for snapshot tests)
 * without touching every fixture.
 */
import { ulid } from "ulid";

export const newId = (): string => ulid();
