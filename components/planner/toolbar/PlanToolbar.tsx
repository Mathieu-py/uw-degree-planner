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
import { ShareModal } from "@/components/planner/modals/ShareModal";
import { Button } from "@/components/ui/Button";
import { DropdownMenu, type MenuItem } from "@/components/ui/DropdownMenu";
import { Icon } from "@/components/ui/Icon";
import { useEscape } from "@/lib/hooks/useEscape";
import { usePlanList } from "@/lib/plan/sync/usePlanList";

interface Props {
  /** Anon users get no bar — they have a single local plan. */
  isAuthed: boolean;
  /**
   * When true, renders as inline flex content (no border/background) so it
   * can sit inside the toolbar's left group. When false, renders as a
   * self-contained bordered card — used by branches that don't have a
   * toolbar (EmptyState, load errors) so the user can still switch plans.
   */
  inline?: boolean;
  /**
   * Inline mode only: rendered between the plan dropdown (left) and the
   * "+ New plan" + options menu (right). PlannerShell injects the save
   * status badge here so it shares a single flex row with the plan switcher.
   */
  children?: ReactNode;
  /**
   * Inline mode only: rendered as the last element in the toolbar, after
   * the "Plan options" menu. Used by PlannerShell for the "Data & settings"
   * menu so it sits at the far right of the header.
   */
  trailing?: ReactNode;
  /**
   * Extra entries appended to the "Edit plan" menu (after rename / duplicate
   * / share / delete). Lets PlannerShell fold plan-settings + workspace-level
   * actions into the same menu so the toolbar doesn't need a second one.
   */
  extraItems?: MenuItem[];
}

function focusOnMount(el: HTMLInputElement | null) {
  el?.focus();
}

/**
 * Compact plan switcher: dropdown of the user's plans, an "Edit plan"
 * overflow menu (rename / duplicate / share / delete), and a primary
 * "+ New plan" button. The four CRUD actions used to render as inline
 * buttons; folding them into a menu keeps the header quiet so the plan
 * dropdown + save indicator stay legible.
 *
 * Rename and delete swap the dropdown for an inline form when active.
 * Their triggers live in the options menu on the right; the form replaces
 * the dropdown on the left because that's where the plan name lives.
 */
export function PlanToolbar({
  isAuthed,
  inline = false,
  children,
  trailing,
  extraItems,
}: Props) {
  if (!isAuthed) return null;
  return (
    <PlanToolbarAuthed
      inline={inline}
      trailing={trailing}
      extraItems={extraItems}
    >
      {children}
    </PlanToolbarAuthed>
  );
}

function PlanToolbarAuthed({
  inline,
  children,
  trailing,
  extraItems,
}: {
  inline: boolean;
  children?: ReactNode;
  trailing?: ReactNode;
  extraItems?: MenuItem[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentPlanId = searchParams.get("planId");
  const { plans, rename, remove, duplicate, share } = usePlanList({
    isAuthed: true,
  });

  const [editing, setEditing] = useState(false);
  const [editingName, setEditingName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [inlineRenameId, setInlineRenameId] = useState<string | null>(null);
  const [inlineRenameName, setInlineRenameName] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function submitInlineRename() {
    if (!inlineRenameId) return;
    const name = inlineRenameName.trim();
    if (!name) {
      setInlineRenameId(null);
      return;
    }
    setBusy(true);
    await rename(inlineRenameId, name);
    setBusy(false);
    setInlineRenameId(null);
  }

  async function confirmDeleteOf(planId: string) {
    setBusy(true);
    const ok = await remove(planId);
    setBusy(false);
    setPendingDeleteId(null);
    if (!ok) return;
    if (planId === currentPlanId) {
      const remaining = (plans ?? []).filter((p) => p.id !== planId);
      navigateToPlan(remaining[0]?.id ?? null);
    }
  }

  useEffect(() => {
    if (!pickerOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [pickerOpen]);

  const dismissInline = useCallback(() => {
    setEditing(false);
    setConfirmingDelete(false);
  }, []);

  // Single Escape handler: close the plan picker and dismiss any inline
  // edit/confirm in one listener. Both actions are no-ops when their state
  // is already cleared, so running both is safe.
  const handleEscape = useCallback(() => {
    setPickerOpen(false);
    dismissInline();
  }, [dismissInline]);
  useEscape(handleEscape);

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
    dismissInline();
    if (planId === currentPlanId) return;
    navigateToPlan(planId);
  }

  function startRename(currentName: string) {
    setEditingName(currentName);
    setEditing(true);
    setConfirmingDelete(false);
  }

  async function submitRename(e: FormEvent) {
    e.preventDefault();
    if (!currentPlanId) return;
    const name = editingName.trim();
    if (!name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    await rename(currentPlanId, name);
    setBusy(false);
    setEditing(false);
  }

  async function duplicatePlanById(planId: string) {
    setBusy(true);
    const newId = await duplicate(planId);
    setBusy(false);
    if (newId) navigateToPlan(newId);
  }

  function openShareModal(id: string, shareToken: string | null) {
    setSharingId(id);
    // Auto-mint a token on first open so the modal shows the URL right
    // away. Already-shared plans skip the round trip.
    if (!shareToken) {
      setBusy(true);
      void share(id, true).finally(() => setBusy(false));
    }
  }

  async function confirmDelete() {
    if (!currentPlanId) return;
    setBusy(true);
    const ok = await remove(currentPlanId);
    setBusy(false);
    setConfirmingDelete(false);
    if (!ok) return;
    const remaining = (plans ?? []).filter((p) => p.id !== currentPlanId);
    navigateToPlan(remaining[0]?.id ?? null);
  }

  function handleCreate() {
    dismissInline();
    router.replace("/plan?new=1");
  }

  // Loading + empty: EmptyState handles the "no plans yet" path on its own,
  // and the planner shell shows a skeleton while plans is loading. The bar
  // would be either duplicative or confusing in those states, so hide it.
  if (plans === null || plans.length === 0) return null;

  const currentPlan = plans.find((p) => p.id === currentPlanId) ?? null;
  if (!currentPlan) return null;

  const sharingPlan = sharingId
    ? (plans.find((p) => p.id === sharingId) ?? null)
    : null;

  const containerClass = inline
    ? "flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 px-3 py-3 w-full min-w-0"
    : "flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-1.5";

  // Editing/confirming swap the dropdown for an inline form. Card mode (non-
  // inline) keeps its old behavior — these flows take over the whole bar.
  if (editing) {
    return (
      <div className={containerClass}>
        <form
          onSubmit={submitRename}
          className="flex items-center gap-1 flex-1 min-w-0"
        >
          <input
            ref={focusOnMount}
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
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
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </form>
      </div>
    );
  }

  if (confirmingDelete) {
    return (
      <div className={containerClass}>
        <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
          <span className="text-xs truncate">Delete "{currentPlan.name}"?</span>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="secondary"
              size="xs"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="xs"
              disabled={busy}
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const actionItems: MenuItem[] = [
    {
      key: "rename",
      label: "Rename",
      icon: <Icon name="rename" size="md" />,
      onSelect: () => startRename(currentPlan.name),
    },
    {
      key: "duplicate",
      label: "Duplicate",
      icon: <Icon name="duplicate" size="md" />,
      disabled: busy,
      onSelect: () => void duplicatePlanById(currentPlan.id),
    },
    {
      key: "share",
      label: "Share",
      icon: <Icon name="share" size="md" />,
      onSelect: () => openShareModal(currentPlan.id, currentPlan.shareToken),
    },
    {
      key: "delete",
      label: "Delete",
      icon: <Icon name="delete" size="lg" />,
      destructive: true,
      onSelect: () => setConfirmingDelete(true),
    },
    ...(extraItems ?? []),
  ];

  const optionsMenu = (
    <DropdownMenu
      label="Edit plan"
      icon={<Icon name="edit" size="sm" />}
      items={actionItems}
    />
  );

  return (
    <>
      {sharingPlan ? (
        <ShareModal
          planName={sharingPlan.name}
          shareToken={sharingPlan.shareToken}
          onClose={() => setSharingId(null)}
        />
      ) : null}

      <div className={containerClass}>
        <div ref={pickerRef} className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            aria-label="Switch plan"
            className="appearance-none rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 pl-3 pr-9 py-2.5 text-sm w-64 text-left truncate relative"
          >
            {currentPlan.name}
            <Icon
              name="chevronDown"
              size="xs"
              aria-hidden="true"
              className="absolute right-3 top-1/2 -translate-y-1/2 opacity-70"
            />
          </button>
          {pickerOpen ? (
            <div
              role="listbox"
              aria-label="Plans"
              className="absolute left-0 top-full mt-1 z-20 w-64 max-h-72 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg py-1"
            >
              {plans.map((p) => {
                const selected = p.id === currentPlan.id;
                const renamingThis = inlineRenameId === p.id;
                const deletingThis = pendingDeleteId === p.id;
                const inlineActive = renamingThis || deletingThis;
                return (
                  <div
                    key={p.id}
                    role="option"
                    aria-selected={selected}
                    tabIndex={inlineActive ? -1 : 0}
                    onClick={() => {
                      if (inlineActive) return;
                      setPickerOpen(false);
                      handleSwitch(p.id);
                    }}
                    onKeyDown={(e) => {
                      if (inlineActive) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setPickerOpen(false);
                        handleSwitch(p.id);
                      }
                    }}
                    className={
                      "group flex items-center gap-2 px-3 py-2 text-sm " +
                      (inlineActive ? "" : "cursor-pointer ") +
                      (selected
                        ? "bg-zinc-100 dark:bg-zinc-900 font-medium"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-900")
                    }
                  >
                    {renamingThis ? (
                      <>
                        <input
                          ref={focusOnMount}
                          value={inlineRenameName}
                          onChange={(e) => setInlineRenameName(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void submitInlineRename();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setInlineRenameId(null);
                            }
                          }}
                          className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-sm"
                          aria-label="New plan name"
                        />
                        <button
                          type="button"
                          disabled={busy || !inlineRenameName.trim()}
                          onClick={(e) => {
                            e.stopPropagation();
                            void submitInlineRename();
                          }}
                          aria-label="Save rename"
                          title="Save"
                          className="h-8 w-8 inline-flex items-center justify-center rounded text-base text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50 hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-50"
                        >
                          <Icon name="check" size="sm" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setInlineRenameId(null);
                          }}
                          aria-label="Cancel rename"
                          title="Cancel"
                          className="h-8 w-8 inline-flex items-center justify-center rounded text-base text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                        >
                          <Icon name="close" size="sm" aria-hidden="true" />
                        </button>
                      </>
                    ) : deletingThis ? (
                      <>
                        <span className="flex-1 truncate text-rose-700 dark:text-rose-300">
                          Delete "{p.name}"?
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            void confirmDeleteOf(p.id);
                          }}
                          aria-label="Confirm delete"
                          title="Delete"
                          className="h-8 w-8 inline-flex items-center justify-center rounded text-base text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
                        >
                          <Icon name="check" size="sm" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDeleteId(null);
                          }}
                          aria-label="Cancel delete"
                          title="Cancel"
                          className="h-8 w-8 inline-flex items-center justify-center rounded text-base text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                        >
                          <Icon name="close" size="sm" aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 truncate">{p.name}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setInlineRenameId(p.id);
                            setInlineRenameName(p.name);
                          }}
                          aria-label={`Rename ${p.name}`}
                          title="Rename"
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-8 w-8 inline-flex items-center justify-center rounded text-base text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-opacity"
                        >
                          <Icon name="rename" size="md" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDeleteId(p.id);
                          }}
                          aria-label={`Delete ${p.name}`}
                          title="Delete"
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-8 w-8 inline-flex items-center justify-center rounded text-base text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-opacity disabled:opacity-50"
                        >
                          <Icon name="delete" size="lg" aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        <Button
          variant="accent"
          size="lg"
          disabled={busy}
          onClick={handleCreate}
          aria-label="New plan"
          className="h-10 w-10 p-0! inline-flex items-center justify-center"
        >
          <Icon name="plusSign" size="lg" />
        </Button>
        {children}
        <div className="ml-auto flex items-center gap-3">
          {optionsMenu}
          {trailing}
        </div>
      </div>
    </>
  );
}
