/**
 * Tests for `EmailSchema`. Per TASKS-0005 §2.2 + PROMPT-0005 §6 (security).
 */
import { describe, expect, it } from "vitest";
import { EmailSchema } from "./email.js";

describe("EmailSchema", () => {
  it("accepts a well-formed email and lowercases it", () => {
    expect(EmailSchema.parse("USER@Example.COM")).toBe("user@example.com");
  });

  it("preserves the local part casing as lowercase after transform", () => {
    expect(EmailSchema.parse("Mixed.Case+tag@DOMAIN.io")).toBe("mixed.case+tag@domain.io");
  });

  it("rejects an invalid email", () => {
    expect(EmailSchema.safeParse("not-email").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(EmailSchema.safeParse("").success).toBe(false);
  });

  it("rejects a string longer than 254 characters", () => {
    const huge = `${"a".repeat(250)}@x.io`;
    expect(EmailSchema.safeParse(huge).success).toBe(false);
  });
});
