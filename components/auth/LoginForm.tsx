"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

const signInSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

const signUpSchema = z
  .object({
    email: z.email("Enter a valid email"),
    // Mirrors `minimum_password_length` in supabase/config.toml.
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords don't match",
  });

type FieldErrors = Partial<
  Record<"email" | "password" | "confirm" | "form", string>
>;

/**
 * Read the `?next=` redirect from the live URL at submit time (browser-only, so
 * no Suspense boundary needed). Falls back to /plan and rejects anything that
 * isn't a plain same-origin path (mirrors the callback route's guard).
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

      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email.trim(),
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

    const parsed = signUpSchema.safeParse({ email, password, confirm });
    if (!parsed.success) {
      setErrors(zodErrors(parsed.error));
      return;
    }
    setBusy(true);

    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error) {
      setBusy(false);
      setErrors(signUpError(error.message));
      return;
    }
    // Email confirmation is disabled, so signUp returns a session — go straight
    // to the planner.
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
        <p className="text-sm text-ink-2">
          {isSignUp ? "Already have an account? " : "Don't have an account? "}
          <button
            type="button"
            onClick={() => switchMode(isSignUp ? "signin" : "signup")}
            className="cursor-pointer font-medium text-accent hover:underline"
          >
            {isSignUp ? "Sign in" : "Sign up"}
          </button>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Field htmlFor="login-email" label="Email" error={errors.email}>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@uwaterloo.ca"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field
          htmlFor="login-password"
          label="Password"
          error={errors.password}
        >
          <Input
            id="login-password"
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {isSignUp && (
          <Field
            htmlFor="login-confirm"
            label="Confirm password"
            error={errors.confirm}
          >
            <Input
              id="login-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
        )}

        {errors.form && (
          <Alert aria-live="assertive" aria-atomic="true">
            {errors.form}
          </Alert>
        )}

        <Button
          type="submit"
          variant="brand"
          size="lg"
          disabled={busy}
          className="mt-1 w-full"
        >
          {busy ? "Please wait…" : isSignUp ? "Sign up" : "Sign in"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-ink-3">
        <span className="h-px flex-1 bg-line" />
        OR
        <span className="h-px flex-1 bg-line" />
      </div>

      <Button
        variant="outline"
        size="lg"
        onClick={signInWithGoogle}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2.5"
      >
        <Icon name="google" size="sm" aria-hidden="true" />
        Sign in with Google
      </Button>
    </div>
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
      <span className="font-semibold text-ink-2">{label}</span>
      {children}
      {error && <span className="text-danger">{error}</span>}
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

/** Map a Supabase signUp error message onto the right field. */
function signUpError(message: string): FieldErrors {
  if (/already registered|already been registered/i.test(message)) {
    return { email: "An account with this email already exists" };
  }
  return { form: message };
}
