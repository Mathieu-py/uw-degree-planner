"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

const INPUT_CLASS =
  "w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30";

const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(20, "Username must be at most 20 characters")
  .regex(
    /^[a-zA-Z0-9_]+$/,
    "Username can only contain letters, numbers, and underscores",
  );

// Sign-in accepts either an email or a username, so the first field is just a
// non-empty identifier here (we detect which it is at submit time). It reuses
// the `email` state / `errors.email` key shared with the sign-up email field.
const signInSchema = z.object({
  email: z.string().min(1, "Enter your email or username"),
  password: z.string().min(1, "Enter your password"),
});

const signUpSchema = z
  .object({
    email: z.string().email("Enter a valid email"),
    username: usernameSchema,
    // Mirrors `minimum_password_length` in supabase/config.toml.
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords don't match",
  });

type FieldErrors = Partial<
  Record<"email" | "username" | "password" | "confirm" | "form", string>
>;

/**
 * Read the `?next=` redirect target from the live URL at submit time. Done here
 * (inside event handlers, browser-only) rather than via `useSearchParams` so the
 * component needs no Suspense boundary. Falls back to /plan, and rejects
 * anything that isn't a plain same-origin path (mirrors the callback route's
 * open-redirect guard).
 */
function readNext(): string {
  if (typeof window === "undefined") return "/plan";
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw) return "/plan";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\"))
    return "/plan";
  return raw;
}

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setErrors({});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const supabase = createSupabaseBrowserClient();
    const next = readNext();

    if (mode === "signin") {
      const parsed = signInSchema.safeParse({ email, password });
      if (!parsed.success) {
        setErrors(zodErrors(parsed.error));
        return;
      }
      setBusy(true);

      // signInWithPassword only takes an email. If the identifier isn't one,
      // treat it as a username and resolve it to an email via the RPC. A
      // generic error keeps username/email failures indistinguishable.
      let loginEmail = parsed.data.email.trim();
      if (!loginEmail.includes("@")) {
        const { data: resolved, error: rpcError } = await supabase.rpc(
          "email_for_username",
          { uname: loginEmail },
        );
        if (rpcError || !resolved) {
          setBusy(false);
          setErrors({ form: "Invalid email/username or password" });
          return;
        }
        loginEmail = resolved as string;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: parsed.data.password,
      });
      if (error) {
        setBusy(false);
        setErrors({ form: error.message });
        return;
      }
      router.push(next);
      return;
    }

    const parsed = signUpSchema.safeParse({
      email,
      username,
      password,
      confirm,
    });
    if (!parsed.success) {
      setErrors(zodErrors(parsed.error));
      return;
    }
    setBusy(true);

    // Username uniqueness is enforced by the DB (the handle_new_user trigger),
    // but a collision there surfaces as a generic "Database error saving new
    // user". Pre-check via the lookup RPC so the common case gets a clean inline
    // message; the constraint still backstops the race between two sign-ups.
    const { data: takenEmail } = await supabase.rpc("email_for_username", {
      uname: parsed.data.username,
    });
    if (takenEmail) {
      setBusy(false);
      setErrors({ username: "An account with that username already exists" });
      return;
    }

    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { data: { username: parsed.data.username } },
    });
    if (error) {
      setBusy(false);
      setErrors(signUpError(error.message));
      return;
    }
    // Email confirmation is disabled on the project, so signUp returns a
    // session and we go straight to the planner.
    router.push(next);
  }

  async function signInWithGoogle() {
    setBusy(true);
    setErrors({});
    const supabase = createSupabaseBrowserClient();
    const next = readNext();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setBusy(false);
      setErrors({ form: error.message });
    }
    // On success the browser navigates away to Google.
  }

  const isSignUp = mode === "signup";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">
          {isSignUp ? "Create your account" : "Welcome back"}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {isSignUp ? "Already have an account? " : "Don't have an account? "}
          <button
            type="button"
            onClick={() => switchMode(isSignUp ? "signin" : "signup")}
            className="cursor-pointer font-medium text-violet-600 hover:text-violet-500 hover:underline"
          >
            {isSignUp ? "Sign in" : "Sign up"}
          </button>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          htmlFor="login-email"
          label={isSignUp ? "Email" : "Email or username"}
          error={errors.email}
        >
          <input
            id="login-email"
            type={isSignUp ? "email" : "text"}
            autoComplete={isSignUp ? "email" : "username"}
            placeholder={
              isSignUp ? "you@uwaterloo.ca" : "you@uwaterloo.ca or goose27"
            }
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>

        {isSignUp && (
          <Field
            htmlFor="login-username"
            label="Username"
            error={errors.username}
          >
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              placeholder="goose27"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
        )}

        <Field
          htmlFor="login-password"
          label="Password"
          error={errors.password}
        >
          <input
            id="login-password"
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>

        {isSignUp && (
          <Field
            htmlFor="login-confirm"
            label="Confirm password"
            error={errors.confirm}
          >
            <input
              id="login-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
        )}

        {errors.form && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            {errors.form}
          </p>
        )}

        <Button
          type="submit"
          variant="accent"
          size="lg"
          disabled={busy}
          className="mt-1 w-full"
        >
          {busy ? "Please wait…" : isSignUp ? "Sign up" : "Sign in"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        OR
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <Button
        variant="secondary"
        size="lg"
        onClick={signInWithGoogle}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2.5"
      >
        <GoogleIcon />
        Sign in with Google
      </Button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A8.98 8.98 0 0 0 9 0 9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

function Field({
  htmlFor,
  label,
  error,
  children,
}: {
  htmlFor: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5 text-xs">
      <span className="font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      {children}
      {error && (
        <span className="text-rose-600 dark:text-rose-400">{error}</span>
      )}
    </label>
  );
}

/** Flatten a ZodError into one message per field for inline display. */
function zodErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in out)) {
      (out as Record<string, string>)[key] = issue.message;
    }
  }
  return out;
}

/**
 * Map a Supabase signUp error message onto the right field. The only way our
 * handle_new_user trigger fails is a duplicate username, which Supabase reports
 * as a generic "Database error saving new user" — translate that to a clear
 * username message. A duplicate email is a distinct error we route to that field.
 */
function signUpError(message: string): FieldErrors {
  // A duplicate username trips the profiles unique constraint; depending on the
  // GoTrue version this surfaces as the raw Postgres error or a generic
  // "Database error saving new user" — match both.
  if (
    /duplicate key|unique constraint|profiles_username|database error/i.test(
      message,
    )
  ) {
    return { username: "An account with that username already exists" };
  }
  if (/already registered|already been registered/i.test(message)) {
    return { email: "An account with this email already exists" };
  }
  return { form: message };
}
