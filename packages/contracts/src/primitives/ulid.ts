/**
 * `UlidSchema` — Crockford-base32 ULID (26 chars).
 *
 * Used as the identifier shape for every domain entity (User, Company,
 * Membership, Invoice, SriDocument, …) per SPEC-0004 §6 and PLAN-0005 §2.
 *
 * Branded to prevent accidental assignment of arbitrary strings to fields
 * that expect a validated ULID at the type level (TASKS-0005 §2.1).
 */
import { z } from "zod";

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const UlidSchema = z
  .string()
  .regex(ULID_REGEX, "ULID inválido (26 caracteres, alfabeto Crockford base32)")
  .brand<"Ulid">();

export type Ulid = z.infer<typeof UlidSchema>;
