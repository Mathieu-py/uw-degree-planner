"use client";

import { useRouter } from "next/navigation";
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
import { DeleteConfirmBar, RenameBar } from "./PlanEditBars";

interface Props {
  /** Anon users get no bar — they have a single local plan. */
  isAuthed: boolean;
  /**
   * Active plan id from the `/plan/[planId]` route param; null at bare `/plan`.
   * Threaded from PlannerShell (which gets it server-side) rather than read from
   * the router here, so the toolbar and the shell share one source of truth.
   */
  planId: string | null;
  /**
   * Inline flex content (no border/bg) to sit in the toolbar's left group, vs.
   * a self-contained bordered card for branches without a toolbar (EmptyState,
   * load errors).
   */
  inline?: boolean;
  /**
   * Inline only: rendered between the plan dropdown and the "+ New plan"/options
   * menu. PlannerShell injects the save-status badge here.
   */
  children?: ReactNode;
  /**
   * Inline only: rendered last, after the options menu. Used for the "Data &
   * settings" menu at the far right.
   */
  trailing?: ReactNode;
  /**
   * Extra entries appended to the "Edit plan" menu, so PlannerShell can fold
   * plan-settings + workspace actions into one menu.
   */
  extraItems?: MenuItem[];
}

function focusOnMount(el: HTMLInputElement | null) {
  el?.focus();
}

/**
 * Compact plan switcher: a plans dropdown, an "Edit plan" overflow menu (rename
 * / duplicate / share / delete), and a "+ New plan" button. CRUD lives in the
 * menu to keep the header quiet. Rename/delete swap the dropdown for an inline
 * form when active (the form replaces the dropdown, where the plan name lives).
 */
export function PlanToolbar({
  isAuthed,
  planId,
  inline = false,
  children,
  trailing,
  extraItems,
}: Props) {
  if (!isAuthed) return null;
  return (
    <PlanToolbarAuthed
      currentPlanId={planId}
      inline={inline}
      trailing={trailing}
      extraItems={extraItems}
    >
      {children}
    </PlanToolbarAuthed>
  );
}

function PlanToolbarAuthed({
  currentPlanId,
  inline,
  children,
  trailing,
  extraItems,
}: {
  currentPlanId: string | null;
  inline: boolean;
  children?: ReactNode;
  trailing?: ReactNode;
  extraItems?: MenuItem[];
}) {
  const router = useRouter();
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

  // Single Escape handler: close the picker and dismiss any inline edit/confirm.
  // Both are no-ops when already cleared, so running both is safe.
  const handleEscape = useCallback(() => {
    setPickerOpen(false);
    dismissInline();
  }, [dismissInline]);
  useEscape(handleEscape);

  const navigateToPlan = useCallback(
    (planId: string | null) => {
      router.replace(planId ? `/plan/${planId}` : "/plan");
    },
    [router],
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
    // Plan creation lives in the /plan/new stepper.
    router.push("/plan/new");
  }

  // Loading + empty: the planner redirects "no plans yet" to /plan/new and
  // skeletons while loading, so the bar would be redundant — hide it.
  if (plans === null || plans.length === 0) return null;

  // A stale/invalid planId in the URL shouldn't hide the toolbar — fall back to
  // the first plan so the user can still switch plans and recover.
  const currentPlan = plans.find((p) => p.id === currentPlanId) ?? plans[0];

  const sharingPlan = sharingId
    ? (plans.find((p) => p.id === sharingId) ?? null)
    : null;

  const containerClass = inline
    ? "flex flex-wrap items-center gap-3 rounded-xl border border-line card-2 px-3 py-3 w-full min-w-0"
    : "flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-1.5";

  // Editing/confirming swap the dropdown for an inline bar. Card mode (non-
  // inline) keeps its old behavior — these flows take over the whole bar.
  if (editing) {
    return (
      <RenameBar
        containerClass={containerClass}
        name={editingName}
        busy={busy}
        onNameChange={setEditingName}
        onSubmit={submitRename}
        onCancel={() => setEditing(false)}
      />
    );
  }

  if (confirmingDelete) {
    return (
      <DeleteConfirmBar
        containerClass={containerClass}
        planName={currentPlan.name}
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
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
      icon: <Icon name="delete" size="md" />,
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
            className="appearance-none rounded-md border border-line-2 bg-bg pl-3 pr-9 py-2.5 text-sm w-64 text-left truncate relative"
          >
            {currentPlan.name}
            <Icon
              name="chevronDown"
              size="xs"
              aria-hidden="true"
              className={`absolute right-3 top-1/2 -translate-y-1/2 opacity-70 transition-transform ${pickerOpen ? "" : "-rotate-90"}`}
            />
          </button>
          {pickerOpen ? (
            <div
              role="listbox"
              aria-label="Plans"
              className="absolute left-0 top-full mt-1 z-20 w-64 max-h-72 overflow-y-auto rounded-md border border-line bg-bg shadow-card-md py-1"
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
                      (selected ? "bg-bg-2 font-medium" : "hover:bg-bg-2")
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
                          className="flex-1 min-w-0 rounded border border-line-2 bg-bg px-2 py-1 text-sm"
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
                          className="h-8 w-8 inline-flex items-center justify-center rounded text-base text-ink-3 hover:text-ink hover:bg-bg-3 disabled:opacity-50"
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
                          className="h-8 w-8 inline-flex items-center justify-center rounded text-base text-ink-3 hover:text-ink hover:bg-bg-3"
                        >
                          <Icon name="close" size="md" aria-hidden="true" />
                        </button>
                      </>
                    ) : deletingThis ? (
                      <>
                        <span className="flex-1 truncate text-danger">
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
                          className="h-8 w-8 inline-flex items-center justify-center rounded text-base text-danger hover:bg-danger-soft disabled:opacity-50"
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
                          className="h-8 w-8 inline-flex items-center justify-center rounded text-base text-ink-3 hover:text-ink hover:bg-bg-3"
                        >
                          <Icon name="close" size="md" aria-hidden="true" />
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
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-8 w-8 inline-flex items-center justify-center rounded text-base text-ink-3 hover:text-ink hover:bg-bg-3 transition-opacity"
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
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-8 w-8 inline-flex items-center justify-center rounded text-base text-danger hover:bg-danger-soft transition-opacity disabled:opacity-50"
                        >
                          <Icon name="delete" size="md" aria-hidden="true" />
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
          variant="brand"
          size="md"
          disabled={busy}
          onClick={handleCreate}
          aria-label="New plan"
          className="h-[42px]! w-[42px] p-0! inline-flex items-center justify-center shrink-0"
        >
          <Icon name="plusSign" size="md" />
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
