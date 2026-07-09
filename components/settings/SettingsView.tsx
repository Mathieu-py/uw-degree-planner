"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { ThemePreviewPicker } from "@/components/theme/ThemePreviewPicker";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { deleteAccount, updateProfile } from "@/lib/account/server/actions";
import { publishUsername, useAuthState } from "@/lib/auth/store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function usernameError(code: string): string {
  switch (code) {
    case "username_required":
      return "Enter a username.";
    case "username_invalid":
      return "3–20 characters, letters, numbers, and underscores only.";
    case "username_taken":
      return "That username is already taken.";
    case "not_authenticated":
      return "Your session expired — please sign in again.";
    default:
      return "Couldn't save. Try again.";
  }
}

export function SettingsView() {
  const { user, username, displayName, ready, isAuthed } = useAuthState();
  const router = useRouter();

  if (!ready) {
    return (
      <div className="section">
        <div className="container-sm flex flex-col gap-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="section">
        <div className="container-sm flex flex-col items-center gap-4 py-16 text-center">
          <Eyebrow>Settings</Eyebrow>
          <h1 className="u-h1">Sign in to manage your account</h1>
          <p className="u-body max-w-md">
            Account settings — your username, appearance, and account removal —
            live behind sign-in. In demo mode there's no account to manage.
          </p>
          <Link
            href="/login?next=/settings"
            className="inline-flex h-11 items-center justify-center rounded-[9px] bg-primary px-5 text-sm font-semibold text-primary-ink hover:bg-primary-hover"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const initials = (displayName ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className="section">
      <div className="container-sm flex flex-col gap-7">
        <div className="flex flex-col gap-1">
          <Eyebrow>Settings</Eyebrow>
          <h1 className="u-h1">Account</h1>
        </div>

        <div className="flex flex-col gap-10 min-w-0">
          <section id="account" className="scroll-mt-24 flex flex-col">
            <div className="flex items-center gap-4 pb-6 border-b border-line">
              <span className="grid place-items-center size-14 rounded-full bg-primary text-primary-ink text-lg font-bold">
                {initials}
              </span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="font-semibold truncate">
                  {displayName ?? "Signed in"}
                </span>
                <span className="u-small truncate">{user?.email}</span>
              </div>
            </div>

            <UsernameRow initialUsername={username ?? ""} />

            <Row label="Email" hint="Used for sign-in and account recovery.">
              <Input
                type="email"
                value={user?.email ?? ""}
                readOnly
                disabled
                className="max-w-[360px] opacity-70"
              />
            </Row>
          </section>

          <section id="appearance" className="scroll-mt-24">
            <h2 className="u-h3 pb-2">Appearance</h2>
            <Row label="Theme" hint="Pick a side — light or dark.">
              <ThemePreviewPicker />
            </Row>
          </section>

          <section id="danger" className="scroll-mt-24">
            <h2 className="u-h3 pb-2 text-danger">Danger zone</h2>
            <Row
              label="Delete account"
              hint="Permanently removes your account and every plan. This can't be undone."
            >
              <DeleteAccountRow onDeleted={() => router.replace("/")} />
            </Row>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6 py-5 border-b border-line">
      <div className="flex flex-col gap-0.5 sm:w-[240px] shrink-0">
        <span className="text-sm font-semibold">{label}</span>
        <span className="u-small">{hint}</span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function UsernameRow({ initialUsername }: { initialUsername: string }) {
  const [value, setValue] = useState(initialUsername);
  const [baseline, setBaseline] = useState(initialUsername);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = value.trim() !== baseline.trim();

  // The store's username arrives async (the profiles fetch can land after
  // mount) — adopt it unless the user has started editing.
  useEffect(() => {
    if (!dirty && initialUsername !== baseline) {
      setValue(initialUsername);
      setBaseline(initialUsername);
    }
  }, [dirty, initialUsername, baseline]);

  async function save() {
    if (busy || !dirty) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await updateProfile({ username: value });
    if (result.ok) {
      setValue(result.data.username);
      setBaseline(result.data.username);
      publishUsername(result.data.username);
      setSaved(true);
    } else {
      setError(usernameError(result.error));
    }
    setBusy(false);
  }

  return (
    <Row label="Username" hint="Shown on your shared plan links.">
      <div className="flex flex-col gap-1.5 max-w-[360px]">
        <div className="flex gap-2.5">
          <Input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
              setError(null);
            }}
            aria-label="Username"
            aria-invalid={error != null}
          />
          <Button variant="outline" onClick={save} disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
        {error ? (
          <p className="text-[13px] text-danger">{error}</p>
        ) : saved ? (
          <p className="text-[13px] text-met">Saved.</p>
        ) : null}
      </div>
    </Row>
  );
}

function DeleteAccountRow({ onDeleted }: { onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await deleteAccount();
    if (!result.ok) {
      setError("Couldn't delete your account. Try again.");
      setBusy(false);
      return;
    }
    // Clear the local session so the header/store reflect the removal, then
    // leave the (now-deleted) account behind for the landing page.
    await createSupabaseBrowserClient().auth.signOut();
    onDeleted();
  }

  if (!confirming) {
    return (
      <Button variant="dangerOutline" onClick={() => setConfirming(true)}>
        Delete account
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] text-danger font-medium">
        This is permanent. Delete your account and all plans?
      </span>
      <div className="flex gap-2">
        <Button variant="danger" onClick={confirmDelete} disabled={busy}>
          {busy ? "Deleting…" : "Yes, delete everything"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setConfirming(false)}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
    </div>
  );
}
