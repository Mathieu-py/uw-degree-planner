"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useCallback, useState } from "react";
import { ShareModal } from "@/components/planner/modals/ShareModal";
import { ActionMenu, type MenuItem } from "@/components/ui/ActionMenu";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import {
  DropdownChevron,
  DropdownSurface,
} from "@/components/ui/DropdownSurface";
import { Icon } from "@/components/ui/Icon";
import { FIELD_CLASSES } from "@/components/ui/Input";
import { useDropdown } from "@/components/ui/useDropdown";
import { describeActionError } from "@/lib/format";
import { useEscape } from "@/lib/hooks/useEscape";
import { usePlanList } from "@/lib/plan/sync/usePlanList";
import { DeleteConfirmBar, RenameBar } from "./PlanEditBars";

/** Bordered toolbar-bar chrome, shared with PlannerShell's anon local-plan bar. */
export const INLINE_BAR_CLASS =
  "flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-bg px-3 py-3 w-full min-w-0";

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
  const { plans, rename, remove, duplicate, share, error, loadError, refetch } =
    usePlanList(true);

  const [editing, setEditing] = useState(false);
  const [editingName, setEditingName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const {
    open: pickerOpen,
    toggle: togglePicker,
    close: closePicker,
    containerRef: pickerRef,
    id: pickerId,
  } = useDropdown();
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

  // Deleting the open plan returns to the plans list rather than auto-opening
  // another; deleting a different plan (from the dropdown) leaves it open.
  function returnToPlansList(deletedId: string) {
    if (deletedId === currentPlanId) router.replace("/plans");
  }

  async function confirmDeleteOf(planId: string) {
    setBusy(true);
    const ok = await remove(planId);
    setBusy(false);
    setPendingDeleteId(null);
    if (!ok) return;
    returnToPlansList(planId);
  }

  const dismissInline = useCallback(() => {
    setEditing(false);
    setConfirmingDelete(false);
  }, []);

  // useDropdown owns Escape/outside-click while the picker is open; this covers
  // the inline rename/delete bars, which render in place of the dropdown.
  useEscape(dismissInline);

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
    returnToPlansList(currentPlanId);
  }

  function handleCreate() {
    dismissInline();
    // Plan creation lives in the /plan/new stepper.
    router.push("/plan/new");
  }

  // A list-load failure with no cached plans surfaces an inline retry rather
  // than silently hiding the toolbar.
  if (loadError && plans === null) {
    return (
      <Alert size="md" onRetry={() => void refetch()} className="w-full">
        {describeActionError(loadError)}
      </Alert>
    );
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
    ? INLINE_BAR_CLASS
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
    <ActionMenu
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
        <div ref={pickerRef} className="relative w-64">
          <button
            type="button"
            onClick={togglePicker}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            aria-controls={pickerOpen ? pickerId : undefined}
            aria-label="Switch plan"
            className={`${FIELD_CLASSES} flex cursor-pointer items-center justify-between gap-2 pl-[13px] pr-3 text-left`}
          >
            <span className="min-w-0 truncate">{currentPlan.name}</span>
            <DropdownChevron open={pickerOpen} />
          </button>
          {pickerOpen ? (
            <DropdownSurface
              id={pickerId}
              role="listbox"
              aria-label="Plans"
              className="left-0 w-full max-h-72 overflow-y-auto"
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
                      closePicker();
                      handleSwitch(p.id);
                    }}
                    onKeyDown={(e) => {
                      if (inlineActive) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        closePicker();
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
                        <Button
                          variant="iconRaised"
                          size="sm"
                          disabled={busy || !inlineRenameName.trim()}
                          onClick={(e) => {
                            e.stopPropagation();
                            void submitInlineRename();
                          }}
                          aria-label="Save rename"
                          title="Save"
                        >
                          <Icon name="check" size="sm" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="iconRaised"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setInlineRenameId(null);
                          }}
                          aria-label="Cancel rename"
                          title="Cancel"
                        >
                          <Icon name="close" size="md" aria-hidden="true" />
                        </Button>
                      </>
                    ) : deletingThis ? (
                      <>
                        <span className="flex-1 truncate text-danger">
                          Delete "{p.name}"?
                        </span>
                        <Button
                          variant="iconDanger"
                          size="sm"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            void confirmDeleteOf(p.id);
                          }}
                          aria-label="Confirm delete"
                          title="Delete"
                        >
                          <Icon name="check" size="sm" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="iconRaised"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDeleteId(null);
                          }}
                          aria-label="Cancel delete"
                          title="Cancel"
                        >
                          <Icon name="close" size="md" aria-hidden="true" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 truncate">{p.name}</span>
                        <Button
                          variant="iconRaised"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setInlineRenameId(p.id);
                            setInlineRenameName(p.name);
                          }}
                          aria-label={`Rename ${p.name}`}
                          title="Rename"
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                        >
                          <Icon name="rename" size="md" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="iconDanger"
                          size="sm"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDeleteId(p.id);
                          }}
                          aria-label={`Delete ${p.name}`}
                          title="Delete"
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                        >
                          <Icon name="delete" size="md" aria-hidden="true" />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </DropdownSurface>
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
      {/* A failed rename/delete/duplicate/share reverts optimistically — this
          banner is the only signal on the planner route. Cleared on next success
          by the shared usePlanList store, so no dismiss wiring. */}
      {error ? (
        <Alert size="md" className="w-full">
          {describeActionError(error)}
        </Alert>
      ) : null}
    </>
  );
}
