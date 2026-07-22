// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Unset the Supabase env BEFORE importing the store (delete, not just omit —
// the runner's env may carry real values) so SUPABASE_CONFIGURED is false.
vi.hoisted(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

const createSupabaseBrowserClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: createSupabaseBrowserClientMock,
}));

import {
  __resetAuthStoreForTests,
  AuthGate,
  SUPABASE_CONFIGURED,
} from "../store";

beforeEach(() => {
  __resetAuthStoreForTests();
});

afterEach(() => {
  cleanup();
  __resetAuthStoreForTests();
});

describe("auth store without Supabase env (unconfigured build)", () => {
  it("computes SUPABASE_CONFIGURED=false at module load", () => {
    expect(SUPABASE_CONFIGURED).toBe(false);
  });

  it("flips ready synchronously, so AuthGate mounts children without a client", () => {
    render(
      <AuthGate fallback={<div>fallback-content</div>}>
        <div>child-content</div>
      </AuthGate>,
    );

    expect(screen.getByText("child-content")).toBeTruthy();
    expect(screen.queryByText("fallback-content")).toBeNull();
    expect(createSupabaseBrowserClientMock).not.toHaveBeenCalled();
  });
});
