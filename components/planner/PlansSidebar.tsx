"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PlanSummary } from "@/lib/plan/server/types";
import { usePlanList } from "@/lib/plan/sync/usePlanList";
import { Button } from "../ui/Button";
import { useEscape } from "./useEscape";

function focusOnMount(el: HTMLInputElement | null) {
  el?.focus();
}

interface Props {
  /** Anon users get no sidebar — they have a single local plan. */
  isAuthed: boolean;
}

/**
 * Left sidebar listing the user's plans with switch / rename / delete /
 * "+ New" actions. At lg+ it sits as a 240px column inside the planner's
 * 3-column shell. Below lg it collapses to a single dropdown trigger
 * ("Plans: {current} ▾") that opens an inline panel above the audit +
 * timeline. Logic ported from the prior header-resident PlanSwitcher.
 */
export function PlansSidebar({ isAuthed }: Props) {
  if (!isAuthed) return null;
  return <PlansSidebarAuthed />;
}

function PlansSidebarAuthed() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentPlanId = searchParams.get("planId");
  const { plans, rename, remove } = usePlanList({ isAuthed: true });

  const [mobileOpen, setMobileOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const mobileContainerRef = useRef<HTMLDivElement | null>(null);

  // Closes transient UI: mobile dropdown, in-progress rename, in-progress
  // delete confirm. Wired to the window-level Escape handler so any of
  // those can be dismissed with one key regardless of where focus lives.
  const dismissTransient = useCallback(() => {
    setMobileOpen(false);
    setEditingId(null);
    setConfirmingDeleteId(null);
  }, []);

  useEscape(dismissTransient);

  // Outside-click for the <lg dropdown only; the desktop sidebar is
  // always-open so it has no outside-close behavior.
  useEffect(() => {
    if (!mobileOpen) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        mobileContainerRef.current &&
        !mobileContainerRef.current.contains(target)
      ) {
        dismissTransient();
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [mobileOpen, dismissTransient]);

  const currentPlan = plans?.find((p) => p.id === currentPlanId) ?? null;
  const triggerLabel = currentPlan?.name ?? "Plans";

  const navigateToPlan = useCallback(
    (planId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (planId) params.set("planId", planId);
      else params.delete("planId");
      const query = params.toString();
      router.replace(query ? `/plan?${query}` : "/plan");
    },
    [router, searchParams],
  );

  function handleSwitch(planId: string) {
    dismissTransient();
    if (planId === currentPlanId) return;
    navigateToPlan(planId);
  }

  function startRename(id: string, currentName: string) {
    setEditingId(id);
    setEditingName(currentName);
    setConfirmingDeleteId(null);
  }

  async function submitRename(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setBusy(true);
    await rename(editingId, editingName);
    setBusy(false);
    setEditingId(null);
  }

  async function confirmDelete(id: string) {
    setBusy(true);
    const wasCurrent = id === currentPlanId;
    const ok = await remove(id);
    setBusy(false);
    setConfirmingDeleteId(null);
    if (!ok) return;
    if (wasCurrent) {
      const remaining = (plans ?? []).filter((p) => p.id !== id);
      navigateToPlan(remaining[0]?.id ?? null);
    }
  }

  function handleCreate() {
    dismissTransient();
    router.replace("/plan?new=1");
  }

  function renderRow(p: PlanSummary): ReactNode {
    const isCurrent = p.id === currentPlanId;
    const isEditing = editingId === p.id;
    const isConfirming = confirmingDeleteId === p.id;
    return (
      <li
        key={p.id}
        className={
          isCurrent
            ? "bg-zinc-100 dark:bg-zinc-900"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
        }
      >
        {isEditing ? (
          <form
            onSubmit={submitRename}
            className="flex items-center gap-1 px-2 py-1.5"
          >
            <input
              ref={focusOnMount}
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingId(null);
              }}
              className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-xs"
              aria-label="New plan name"
            />
            <Button
              type="submit"
              size="sm"
              disabled={busy || !editingName.trim()}
            >
              Save
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditingId(null)}
            >
              Cancel
            </Button>
          </form>
        ) : isConfirming ? (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-xs truncate">Delete "{p.name}"?</span>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="secondary"
                size="xs"
                onClick={() => setConfirmingDeleteId(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="xs"
                disabled={busy}
                onClick={() => confirmDelete(p.id)}
              >
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-1 px-3 py-1.5">
            <button
              type="button"
              onClick={() => handleSwitch(p.id)}
              aria-current={isCurrent ? "page" : undefined}
              className="flex-1 min-w-0 text-left text-xs truncate"
              title={p.name}
            >
              {p.name}
            </button>
            <div className="flex items-center gap-0.5 shrink-0 text-zinc-500">
              <Button
                variant="icon"
                onClick={() => startRename(p.id, p.name)}
                aria-label={`Rename ${p.name}`}
                className="hover:bg-zinc-200 dark:hover:bg-zinc-800"
              >
                ✏️
              </Button>
              <Button
                variant="icon"
                onClick={() => {
                  setConfirmingDeleteId(p.id);
                  setEditingId(null);
                }}
                aria-label={`Delete ${p.name}`}
                className="hover:!text-rose-600 dark:hover:!text-rose-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
              >
                🗑
              </Button>
            </div>
          </div>
        )}
      </li>
    );
  }

  const plansList: ReactNode =
    plans === null ? (
      <div className="px-3 py-2 text-xs text-zinc-500">Loading…</div>
    ) : plans.length === 0 ? (
      <div className="px-3 py-2 text-xs text-zinc-500">No plans yet.</div>
    ) : (
      <ul className="max-h-80 overflow-auto py-1">{plans.map(renderRow)}</ul>
    );

  const newButton = (
    <button
      type="button"
      disabled={busy}
      onClick={handleCreate}
      className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900/60 disabled:opacity-50"
    >
      + New plan
    </button>
  );

  return (
    <>
      {/* lg+: full sidebar column */}
      <aside
        aria-labelledby="plans-sidebar-header"
        className="hidden lg:flex lg:flex-col w-60 shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden h-fit"
      >
        <div
          id="plans-sidebar-header"
          className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
        >
          Plans
        </div>
        {plansList}
        <div className="border-t border-zinc-200 dark:border-zinc-800">
          {newButton}
        </div>
      </aside>

      {/* <lg: dropdown trigger + inline panel */}
      <div ref={mobileContainerRef} className="lg:hidden relative">
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={mobileOpen}
          aria-label={`Plans: ${triggerLabel}`}
          className="flex w-full items-center justify-between gap-2 rounded border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-zinc-500 dark:text-zinc-400">Plans:</span>
            <span className="truncate font-medium">{triggerLabel}</span>
          </span>
          <span aria-hidden="true" className="text-zinc-500 shrink-0">
            ▾
          </span>
        </button>

        {mobileOpen ? (
          <div
            role="menu"
            aria-label="Plans"
            className="absolute left-0 right-0 top-full z-40 mt-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg text-sm overflow-hidden"
          >
            {plansList}
            <div className="border-t border-zinc-200 dark:border-zinc-800">
              {newButton}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
