/**
 * Multi-tab auth coordination via BroadcastChannel.
 *
 * When the user signs out in one tab we want every other open tab to
 * follow them out — leaving a stale "logged-in" shell in a background tab
 * is a confusing security UX. We use the cross-origin-safe
 * `BroadcastChannel` API (not localStorage) so the signal works even when
 * the user disabled third-party storage.
 *
 * Contract:
 *   - `broadcastSignout()` sends a `"signout"` message on the `"auth"`
 *     channel.
 *   - `subscribeAuthChannel(listener)` returns an unsubscriber.
 *
 * Tests substitute a mocked `BroadcastChannel` via the global; jsdom
 * provides one in Vitest >= 1.6 (we polyfill if missing).
 */

export type AuthChannelMessage = "signout";

export const AUTH_CHANNEL_NAME = "auth";

type MaybeBroadcastChannelCtor = new (name: string) => BroadcastChannel;

function getBroadcastChannelCtor(): MaybeBroadcastChannelCtor | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return BroadcastChannel as unknown as MaybeBroadcastChannelCtor;
}

let cached: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (cached !== null) return cached;
  const Ctor = getBroadcastChannelCtor();
  if (Ctor === null) return null;
  cached = new Ctor(AUTH_CHANNEL_NAME);
  return cached;
}

/** Test seam: wipe the cached channel between tests. */
export function __resetAuthChannelForTests(): void {
  if (cached !== null) {
    try {
      cached.close();
    } catch {
      /* ignore */
    }
  }
  cached = null;
}

export function broadcastSignout(): void {
  const ch = getChannel();
  if (ch === null) return;
  ch.postMessage("signout" satisfies AuthChannelMessage);
}

export function subscribeAuthChannel(
  listener: (msg: AuthChannelMessage) => void,
): () => void {
  const ch = getChannel();
  if (ch === null) return () => undefined;
  const handler = (event: MessageEvent<unknown>): void => {
    const data = event.data;
    if (data === "signout") {
      listener("signout");
    }
  };
  ch.addEventListener("message", handler);
  return () => {
    ch.removeEventListener("message", handler);
  };
}
