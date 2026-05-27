/**
 * Unit tests for `InMemoryBlobStore` — the placeholder implementation
 * used by the sign-step until SPEC-0026 lands.
 */
import { describe, expect, it } from "vitest";

import { InMemoryBlobStore } from "./blob-store.js";

describe("InMemoryBlobStore", () => {
  it("put + get round-trips the payload", async () => {
    const store = new InMemoryBlobStore();
    const { key, bytes } = await store.put("foo/bar.xml", "<x/>");
    expect(key).toBe("foo/bar.xml");
    expect(bytes).toBe(4);
    expect(await store.get("foo/bar.xml")).toBe("<x/>");
  });

  it("get returns null for an unknown key", async () => {
    const store = new InMemoryBlobStore();
    expect(await store.get("nope")).toBeNull();
  });

  it("clear empties the store; size reflects current entries", async () => {
    const store = new InMemoryBlobStore();
    expect(store.size()).toBe(0);
    await store.put("a", "1");
    await store.put("b", "2");
    expect(store.size()).toBe(2);
    store.clear();
    expect(store.size()).toBe(0);
  });

  it("put overwrites an existing key (last write wins)", async () => {
    const store = new InMemoryBlobStore();
    await store.put("k", "first");
    await store.put("k", "second");
    expect(await store.get("k")).toBe("second");
    expect(store.size()).toBe(1);
  });
});
