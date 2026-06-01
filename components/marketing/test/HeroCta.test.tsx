// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroCta } from "../HeroCta";

const { authStateRef } = vi.hoisted(() => ({
  authStateRef: { current: { isAuthed: false } },
}));
vi.mock("@/lib/auth/store", () => ({
  useAuthState: () => authStateRef.current,
}));

afterEach(cleanup);

describe("HeroCta", () => {
  it("shows the demo + sign-in CTAs when signed out", () => {
    authStateRef.current = { isAuthed: false };
    render(<HeroCta />);

    const cta = screen.getByRole("link", { name: /try the demo/i });
    expect(cta.getAttribute("href")).toBe("/plan");
    expect(
      screen.getByRole("link", { name: /sign in/i }).getAttribute("href"),
    ).toBe("/login");
    expect(screen.queryByRole("link", { name: /go to my plans/i })).toBeNull();
  });

  it("swaps to the plans CTA and drops sign-in when authed", () => {
    authStateRef.current = { isAuthed: true };
    render(<HeroCta />);

    const cta = screen.getByRole("link", { name: /go to my plans/i });
    expect(cta.getAttribute("href")).toBe("/plans");
    expect(screen.queryByRole("link", { name: /try the demo/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
  });
});
