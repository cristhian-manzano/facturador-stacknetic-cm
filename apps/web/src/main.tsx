/**
 * Vite + React entrypoint for `apps/web` (SPEC-0040 §6.4).
 *
 * Mounts the `<App />` provider tree on `#root`. Loads the global Tailwind
 * stylesheet so design tokens apply before first paint (NFR-3, no FOUC).
 *
 * The router is built once and handed in so tests can swap a memory
 * router without re-mounting the file.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { createAppRouter } from "./routes/router.js";
import "./styles/globals.css";

const rootEl = document.getElementById("root");

if (!rootEl) {
  throw new Error("[web] #root element missing from index.html");
}

createRoot(rootEl).render(
  <StrictMode>
    <App router={createAppRouter()} />
  </StrictMode>,
);
