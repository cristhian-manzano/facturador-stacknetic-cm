/**
 * MSW Node server for `@facturador/api` integration tests.
 *
 * Tests register handlers as needed (sri-handlers, future ones).  The setup
 * file in `apps/api/test/setup.ts` calls `listen / resetHandlers / close`.
 *
 * Per TASKS-0007 §4.3 + SPEC-0007 §6.5 — the api workspace uses MSW only
 * to stub OUTBOUND calls (chiefly to `apps/sri-core`).  There is no
 * inbound HTTP stubbing here; supertest drives the express app directly.
 */
import { setupServer } from "msw/node";

export const mswServer = setupServer();
