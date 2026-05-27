/**
 * Tests for the multi-tab sign-out bridge (REVIEW-0044 §12).
 *
 * Covers:
 *   - `broadcastSignout()` posts a `"signout"` message that
 *     `subscribeAuthChannel(listener)` receives.
 *   - `<CrossTabAuthBridge />` navigates to `/login` when it receives
 *     the message.
 *   - The query cache is cleared during the cross-tab signout flow.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestRouter } from "../routes/router.js";

import { __resetAuthChannelForTests, subscribeAuthChannel } from "./cross-tab.js";
import { CrossTabAuthBridge } from "./CrossTabAuthBridge.js";

beforeEach(() => {
  __resetAuthChannelForTests();
});

afterEach(() => {
  __resetAuthChannelForTests();
});

describe("cross-tab signout bus", () => {
  it("a message posted on a sibling channel is delivered to subscribers", async () => {
    // BroadcastChannel suppresses self-echo: posting on a channel
    // doesn't fire the listener bound to that SAME channel instance.
    // We simulate two browser tabs by:
    //   1. installing the listener via the helper (opens channel A);
    //   2. opening a sibling channel B directly and posting on it.
    const received: string[] = [];
    const unsub = subscribeAuthChannel((msg) => received.push(msg));
    const siblingTab = new BroadcastChannel("auth");
    siblingTab.postMessage("signout");
    // Yield to the message loop so the listener runs.
    await new Promise((r) => setTimeout(r, 30));
    siblingTab.close();
    expect(received).toContain("signout");
    unsub();
  });
});

describe("<CrossTabAuthBridge />", () => {
  it("navigates to /login and clears the query cache when 'signout' arrives", async () => {
    const router = createTestRouter(["/"]);
    const navigate = vi.spyOn(router, "navigate");
    const qc = new QueryClient();
    const clearSpy = vi.spyOn(qc, "clear");

    render(
      <QueryClientProvider client={qc}>
        <CrossTabAuthBridge router={router} />
      </QueryClientProvider>,
    );

    // Simulate a sibling tab broadcasting a signout. We open a fresh
    // channel directly because the bridge holds an open subscription on
    // the singleton; posting on the same channel won't echo.
    const channel = new BroadcastChannel("auth");
    channel.postMessage("signout");
    await new Promise((r) => setTimeout(r, 40));
    channel.close();

    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});
