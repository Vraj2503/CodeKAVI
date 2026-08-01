/**
 * Tests that `AuthProvider` always finishes loading.
 *
 * `loading` gates the whole app: repo pages wait on it before they resolve
 * anything. The original effect called `getSession().then(...)` with no
 * `.catch()` and no deadline — and `getSession()` is not a local read, it
 * refreshes an expired token over the network. A reject or a hang left
 * `loading` true forever, which surfaced to users as a permanent
 * "Loading repository data…" on every repo page.
 *
 * So the invariant is narrow and absolute: **loading always reaches false.**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "../auth-context";

const getSession = vi.fn();
const onAuthStateChange = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => getSession(...a),
      onAuthStateChange: (...a: unknown[]) => onAuthStateChange(...a),
      signOut: vi.fn(),
    },
  },
}));

function Probe() {
  const { loading, user } = useAuth();
  return <div data-testid="s">{loading ? "loading" : `ready:${user?.id ?? "anon"}`}</div>;
}

const state = () => screen.getByTestId("s").textContent;

const renderAuth = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("AuthProvider", () => {
  it("settles with the session on success", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    renderAuth();
    await waitFor(() => expect(state()).toBe("ready:u1"));
  });

  it("settles signed-out when the session lookup rejects", async () => {
    // Previously there was no `.catch()`, so this hung `loading` forever.
    getSession.mockRejectedValue(new Error("network down"));
    renderAuth();
    await waitFor(() => expect(state()).toBe("ready:anon"));
  });

  it("settles signed-out when the session lookup never answers", async () => {
    // No `.catch()` can reach this one — only a deadline can.
    vi.useFakeTimers();
    getSession.mockReturnValue(new Promise(() => {}));

    renderAuth();
    expect(state()).toBe("loading");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });

    expect(state()).toBe("ready:anon");
    vi.useRealTimers();
  });

  it("adopts a session that arrives after the deadline", async () => {
    // The deadline guesses "signed out". `onAuthStateChange` is what makes
    // that guess safe rather than permanent.
    vi.useFakeTimers();
    getSession.mockReturnValue(new Promise(() => {}));
    let emit: ((e: string, s: unknown) => void) | null = null;
    onAuthStateChange.mockImplementation((cb: (e: string, s: unknown) => void) => {
      emit = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    renderAuth();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(state()).toBe("ready:anon");

    await act(async () => {
      emit?.("SIGNED_IN", { user: { id: "late" } });
    });
    expect(state()).toBe("ready:late");
    vi.useRealTimers();
  });
});
