"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon } from "@/components/ui/Icon";
import { Pill } from "@/components/ui/Pill";
import { Segmented } from "@/components/ui/Segmented";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuthState } from "@/lib/auth/store";
import type { PlanSummary } from "@/lib/plan/server/types";
import { usePlanList } from "@/lib/plan/sync/usePlanList";

type ViewMode = "grid" | "list";

function streamLabel(stream: PlanSummary["stream"]): string {
  if (stream === "stream4") return "Stream 4 co-op";
  if (stream === "stream8") return "Stream 8 co-op";
  if (stream === "regular") return "Regular";
  return "—";
}

function formatUpdated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DashboardView({
  programNames,
}: {
  programNames: Record<string, string>;
}) {
  const { isAuthed, ready } = useAuthState();
  const { plans, remove, duplicate } = usePlanList({ isAuthed });
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("grid");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (!ready) {
    return (
      <div className="section">
        <div className="container-lg flex flex-col gap-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="section">
        <div className="container-sm flex flex-col items-center gap-4 py-16 text-center">
          <Eyebrow>My plans</Eyebrow>
          <h1 className="u-h1">Sign in to manage multiple plans</h1>
          <p className="u-body max-w-md">
            Signed in, you can keep several plans side by side — compare
            streams, majors, or what-if scenarios. In demo mode you have a
            single local plan.
          </p>
          <div className="flex gap-3">
            <Link
              href="/login"
              className="inline-flex h-11 items-center justify-center rounded-[9px] bg-primary px-5 text-sm font-semibold text-primary-ink hover:bg-primary-hover"
            >
              Sign in
            </Link>
            <Link
              href="/plan"
              className="inline-flex h-11 items-center justify-center rounded-[9px] border border-line-2 bg-bg px-5 text-sm font-semibold text-ink hover:bg-bg-2"
            >
              Open demo planner
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const list = plans ?? [];
  const sharedCount = list.filter((p) => p.shareToken).length;
  const programCount = new Set(list.map((p) => p.programId).filter(Boolean))
    .size;
  const lastUpdated =
    list.length > 0
      ? formatUpdated(
          list.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b)).updatedAt,
        )
      : "—";

  async function onDelete(id: string) {
    setConfirmId(null);
    await remove(id);
  }

  async function onDuplicate(id: string) {
    const newId = await duplicate(id);
    if (newId) router.push(`/plan?planId=${newId}`);
  }

  return (
    <div className="section">
      <div className="container-lg flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Eyebrow>Your plans</Eyebrow>
            <h1 className="u-h1">My plans</h1>
          </div>
          <Link
            href="/plan/new"
            className="inline-flex h-[42px] items-center gap-2 rounded-[9px] bg-primary px-[18px] text-sm font-semibold text-primary-ink hover:bg-primary-hover"
          >
            <Icon name="plusSign" size="sm" aria-hidden="true" />
            New plan
          </Link>
        </div>

        {/* Stat strip */}
        <div className="card grid grid-cols-2 sm:grid-cols-4 divide-x divide-line">
          <Stat label="Plans" value={String(list.length)} />
          <Stat label="Programs" value={String(programCount)} />
          <Stat label="Shared" value={String(sharedCount)} />
          <Stat label="Last updated" value={lastUpdated} />
        </div>

        {/* View toggle */}
        <div className="flex items-center justify-between">
          <span className="u-small">
            {list.length} plan{list.length === 1 ? "" : "s"}
          </span>
          <Segmented<ViewMode>
            ariaLabel="View mode"
            value={view}
            onChange={setView}
            options={[
              {
                value: "grid",
                ariaLabel: "Grid",
                label: <Icon name="grid" size="sm" />,
              },
              {
                value: "list",
                ariaLabel: "List",
                label: <Icon name="list" size="sm" />,
              },
            ]}
          />
        </div>

        {/* Plan cards */}
        <div
          className={
            view === "grid"
              ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
              : "flex flex-col gap-2"
          }
        >
          {list.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              programName={p.programId ? programNames[p.programId] : null}
              view={view}
              confirming={confirmId === p.id}
              onConfirm={() => setConfirmId(p.id)}
              onCancelConfirm={() => setConfirmId(null)}
              onDelete={() => onDelete(p.id)}
              onDuplicate={() => onDuplicate(p.id)}
            />
          ))}
          <Link
            href="/plan/new"
            className="flex min-h-[132px] items-center justify-center gap-2 rounded-[14px] border border-dashed border-line-2 text-sm font-medium text-ink-3 transition-colors hover:border-accent-bg hover:bg-accent-soft hover:text-accent"
          >
            <Icon name="plusSign" size="sm" aria-hidden="true" />
            Start a new plan
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <span className="u-small">{label}</span>
      <span className="text-xl font-bold tabular-nums truncate">{value}</span>
    </div>
  );
}

function PlanCard({
  plan,
  programName,
  view,
  confirming,
  onConfirm,
  onCancelConfirm,
  onDelete,
  onDuplicate,
}: {
  plan: PlanSummary;
  programName: string | null;
  view: ViewMode;
  confirming: boolean;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const meta = `${streamLabel(plan.stream)} · updated ${formatUpdated(plan.updatedAt)}`;
  return (
    <div
      className={`card p-4 flex ${view === "grid" ? "flex-col gap-3" : "flex-row items-center gap-4"}`}
    >
      <div className="min-w-0 flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/plan?planId=${plan.id}`}
            className="u-h3 text-[16px] truncate hover:text-accent"
          >
            {plan.name}
          </Link>
          {plan.shareToken ? <Pill>Shared</Pill> : null}
        </div>
        <span className="u-small truncate">{programName ?? "No program"}</span>
        <span className="u-small">{meta}</span>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {confirming ? (
          <>
            <span className="u-small text-danger mr-1">Delete?</span>
            <Button variant="danger" size="sm" onClick={onDelete}>
              Yes
            </Button>
            <Button variant="outline" size="sm" onClick={onCancelConfirm}>
              No
            </Button>
          </>
        ) : (
          <>
            <Link
              href={`/plan?planId=${plan.id}`}
              className="inline-flex h-[34px] items-center rounded-[8px] bg-primary px-3 text-[13px] font-semibold text-primary-ink hover:bg-primary-hover"
            >
              Open
            </Link>
            <Button
              variant="icon"
              onClick={onDuplicate}
              aria-label="Duplicate plan"
              title="Duplicate"
            >
              <Icon name="copy" size="sm" aria-hidden="true" />
            </Button>
            <Button
              variant="icon"
              onClick={onConfirm}
              aria-label="Delete plan"
              title="Delete"
              className="hover:text-danger"
            >
              <Icon name="delete" size="sm" aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
