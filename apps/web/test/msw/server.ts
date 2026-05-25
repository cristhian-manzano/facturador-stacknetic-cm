/**
 * MSW Node server for `@facturador/web` tests (TASKS-0007 §4.1).
 *
 * The component tests run in jsdom, but jsdom's fetch implementation still
 * goes through Node's HTTP stack, so `msw/node` (not `msw/browser`) is the
 * correct adapter.  Handlers live in `./handlers.ts` and validate every
 * response against the corresponding contract schema.
 */
import { setupServer } from "msw/node";

export const mswServer = setupServer();
