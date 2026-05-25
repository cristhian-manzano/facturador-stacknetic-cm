/**
 * `AuthContext` — single source of truth for FE auth state
 * (SPEC-0040 §6 / PLAN-0040 §4 Phase 3 / TASKS-0040 §3).
 *
 * Responsibilities:
 *   1. On mount, call `GET /api/v1/me` via `apiFetch` (so the cookie + CSRF
 *      contract is enforced). The response is validated against
 *      `MeResponseSchema` from `@facturador/contracts/auth`.
 *   2. Expose a stable shape:
 *
 *        {
 *          status: "loading" | "unauthenticated" | "ready" | "error",
 *          user, memberships, currentCompanyId, currentRole, permissions,
 *          isLoading, refresh, signOut
 *        }
 *
 *   3. Listen to the global `auth:401` event dispatched by `apiFetch` and
 *      flip back to `unauthenticated` (the route guard navigates the user).
 *   4. Provide `useAuth()` for consumers.
 *
 * Security notes:
 *   - Nothing here writes to `localStorage` / `sessionStorage`. The session
 *     cookie is HttpOnly; the CSRF cookie is JS-readable but managed by
 *     `apiFetch`.
 *   - On 401 we clear the cached user object so a stale UI cannot keep
 *     rendering a logged-in shell.
 *   - `signOut` issues `POST /api/v1/auth/logout`; the cookie clears
 *     server-side. We still clear state locally even if the request
 *     fails (defence in depth — best-effort logout).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  MeResponseSchema,
  type MeResponse,
  type MembershipSummary,
  type Role,
  type UserPublic,
} from "@facturador/contracts/auth";
import type { Action } from "@facturador/utils/rbac";

import { apiFetch, AUTH_EVENT_UNAUTHORIZED } from "../lib/api.js";

/** Lifecycle states the consumer cares about. */
export type AuthStatus = "loading" | "unauthenticated" | "ready" | "error";

/**
 * Shape every `useAuth()` consumer sees. Kept narrow — adding fields here
 * forces every consumer to re-think coupling. Permissions are typed as
 * `Action[]` so call sites get autocomplete + exhaustive checks.
 */
export interface AuthContextValue {
  status: AuthStatus;
  isLoading: boolean;
  user: UserPublic | null;
  memberships: readonly MembershipSummary[];
  currentCompanyId: string | null;
  currentRole: Role | null;
  permissions: readonly Action[];
  /** Force a re-fetch of `/me` — used after tenant switch / profile edit. */
  refresh: () => Promise<void>;
  /** Best-effort logout: clears the server session + local state. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Cast `MeResponse.permissions` (server type: `string[]`) to the SPA's
 * narrow `Action[]` typing. Unknown actions slip through but `can()`
 * already rejects them defensively, so the worst case is a UI element
 * stays hidden — never security-relevant.
 */
function toActions(perms: readonly string[]): readonly Action[] {
  return perms as readonly Action[];
}

export interface AuthProviderProps {
  children: ReactNode;
  /**
   * Test seam: skip the initial `/me` fetch and start from this state.
   * Production code never sets this. The test files in
   * `apps/web/src/auth/*.test.tsx` use it to drive the guard tree
   * without round-tripping through MSW.
   *
   * Typed as `unknown` because tests pass plain literals — we parse them
   * through `MeResponseSchema` to obtain the branded types.
   */
  initialState?: unknown;
}

interface State {
  status: AuthStatus;
  user: UserPublic | null;
  memberships: readonly MembershipSummary[];
  currentCompanyId: string | null;
  currentRole: Role | null;
  permissions: readonly Action[];
}

const EMPTY_STATE: State = {
  status: "loading",
  user: null,
  memberships: [],
  currentCompanyId: null,
  currentRole: null,
  permissions: [],
};

function stateFromMe(me: MeResponse): State {
  return {
    status: "ready",
    user: me.user,
    memberships: me.memberships,
    currentCompanyId: me.activeCompanyId,
    currentRole: me.currentRole,
    permissions: toActions(me.permissions),
  };
}

export function AuthProvider({ children, initialState }: AuthProviderProps): ReactElement {
  // `useRef` so re-render doesn't reset the bootstrap guard.
  const bootstrapped = useRef(false);
  const [state, setState] = useState<State>(() => {
    if (initialState === undefined) return EMPTY_STATE;
    if (initialState === null) {
      return { ...EMPTY_STATE, status: "unauthenticated" };
    }
    // Best-effort: merge what the test gave us on top of EMPTY_STATE.
    const parsed = MeResponseSchema.safeParse(initialState);
    if (!parsed.success) return EMPTY_STATE;
    return stateFromMe(parsed.data);
  });

  const fetchMe = useCallback(async (): Promise<void> => {
    try {
      const me = await apiFetch("/api/v1/me", { schema: MeResponseSchema });
      setState(stateFromMe(me));
    } catch (cause) {
      // 401 → unauthenticated. Anything else stays in "error" so we don't
      // accidentally route a network outage to /login.
      const status = (cause as { status?: number }).status;
      if (status === 401) {
        setState({ ...EMPTY_STATE, status: "unauthenticated" });
      } else {
        setState({ ...EMPTY_STATE, status: "error" });
      }
    }
  }, []);

  // Bootstrap on mount unless a test pre-seeded state.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    if (initialState !== undefined) return;
    void fetchMe();
  }, [fetchMe, initialState]);

  // Global 401 listener — apiFetch dispatches this from anywhere.
  useEffect(() => {
    const onUnauthorized = (): void => {
      setState({ ...EMPTY_STATE, status: "unauthenticated" });
    };
    window.addEventListener(AUTH_EVENT_UNAUTHORIZED, onUnauthorized);
    return () => {
      window.removeEventListener(AUTH_EVENT_UNAUTHORIZED, onUnauthorized);
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, status: "loading" }));
    await fetchMe();
  }, [fetchMe]);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // Logout is best-effort; we still clear local state below.
    }
    setState({ ...EMPTY_STATE, status: "unauthenticated" });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      isLoading: state.status === "loading",
      user: state.user,
      memberships: state.memberships,
      currentCompanyId: state.currentCompanyId,
      currentRole: state.currentRole,
      permissions: state.permissions,
      refresh,
      signOut,
    }),
    [state, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}
