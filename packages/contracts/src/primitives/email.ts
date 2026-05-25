/**
 * `EmailSchema` — RFC-style email, transformed to lowercase, length-capped.
 *
 * Lowercasing on parse (TASKS-0005 §2.2 + PROMPT-0005 §6) guarantees that
 * downstream comparisons (login, uniqueness, audit) match regardless of how
 * the user typed the address. The raw form is never re-emitted from this
 * package — it cannot leak through.
 *
 * Cap at 254 chars (RFC 3696 §3) protects against unbounded-string DoS per
 * SPEC-0005 §10.
 *
 * Branded so a plain `string` cannot be assigned to a field expecting an
 * already-validated email.
 */
import { z } from "zod";

export const EmailSchema = z
  .string()
  .min(3, "email es requerido")
  .max(254, "email excede 254 caracteres")
  .email("email inválido")
  .transform((value) => value.toLowerCase())
  .brand<"Email">();

export type Email = z.infer<typeof EmailSchema>;
