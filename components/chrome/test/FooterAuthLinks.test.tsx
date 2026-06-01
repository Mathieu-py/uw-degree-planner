// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FooterAuthLinks } from "../FooterAuthLinks";

const { authStateRef } = vi.hoisted(() => ({
  authStateRef: { current: { isAuthed: false } },
}));
vi.mock("@/lib/auth/store", () => ({
  useAuthState: () => authStateRef.current,
}));

afterEach(cleanup);

describe("FooterAuthLinks", () => {
  it("shows the demo + sign-in links when signed out", () => {
    authStateRef.current = { isAuthed: false };
    render(<FooterAuthLinks />);

    expect(
      screen.getByRole("link", { name: /try the demo/i }).getAttribute("href"),
    ).toBe("/plan");
    expect(
      screen.getByRole("link", { name: /sign in/i }).getAttribute("href"),
    ).toBe("/login");
  });

  it("swaps to the plans link and drops sign-in when authed", () => {
    authStateRef.current = { isAuthed: true };
    render(<FooterAuthLinks />);

    expect(
      screen
        .getByRole("link", { name: /go to my plans/i })
        .getAttribute("href"),
    ).toBe("/plans");
    expect(screen.queryByRole("link", { name: /try the demo/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
  });
});
