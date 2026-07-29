// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

const { signInMock, signUpMock, rpcMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  signUpMock: vi.fn(),
  rpcMock: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signInWithPassword: signInMock,
      signUp: signUpMock,
      signInWithOAuth: vi.fn(),
    },
    rpc: rpcMock,
  }),
}));

import { LoginForm } from "../LoginForm";

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

// Exact-name lookup: "Sign in" ≠ "Sign in with Google" ≠ the mode-toggle link,
// so the submit button is unambiguous in both modes.
function submit(name: "Sign in" | "Sign up") {
  const button = screen.getByRole("button", { name });
  fireEvent.submit(button.closest("form") as HTMLFormElement);
}

beforeEach(() => {
  routerPushMock.mockReset();
  signInMock.mockReset();
  signUpMock.mockReset();
  rpcMock.mockReset();
});

afterEach(cleanup);

describe("LoginForm — email-only auth (username removed)", () => {
  it("signs in with the typed email and never calls an RPC", async () => {
    signInMock.mockResolvedValue({ error: null });
    render(<LoginForm />);

    fill("Email", "goose@uwaterloo.ca");
    fill("Password", "hunter22");
    submit("Sign in");

    expect(
      await screen.findByRole("button", { name: /please wait/i }),
    ).toBeTruthy();
    expect(signInMock).toHaveBeenCalledWith({
      email: "goose@uwaterloo.ca",
      password: "hunter22",
    });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(routerPushMock).toHaveBeenCalledWith("/plan");
  });

  it("rejects a non-email identifier without submitting", () => {
    render(<LoginForm />);

    fill("Email", "goose27");
    fill("Password", "hunter22");
    submit("Sign in");

    expect(screen.getByText("Enter a valid email")).toBeTruthy();
    expect(signInMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("maps a duplicate-email signUp error to the email field", async () => {
    signUpMock.mockResolvedValue({
      error: { message: "User already registered" },
    });
    render(<LoginForm />);

    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    fill("Email", "goose@uwaterloo.ca");
    fill("Password", "hunter22");
    fill("Confirm password", "hunter22");
    submit("Sign up");

    expect(
      await screen.findByText("An account with this email already exists"),
    ).toBeTruthy();
    expect(signUpMock).toHaveBeenCalledWith({
      email: "goose@uwaterloo.ca",
      password: "hunter22",
    });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(routerPushMock).not.toHaveBeenCalled();
  });
});
