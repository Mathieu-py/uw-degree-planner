interface Props {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}

export function Pagination({ page, totalPages, onChange }: Props) {
  const items = paginationWindow(page, totalPages);
  return (
    <nav
      className="flex flex-wrap items-center justify-center gap-1 text-xs"
    >
      <PageButton
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        label="« Prev"
      />
      {items.map((it, i) =>
        it === "…" ? (
          <span
            key={`gap-${i}`}
            className="px-2 py-1 text-zinc-400 dark:text-zinc-600"
          >
            …
          </span>
        ) : it === page ? (
          <span
            key={it}
            className="rounded border border-zinc-950 dark:border-zinc-50 bg-zinc-950 dark:bg-zinc-50 px-2 py-1 font-medium tabular-nums text-white dark:text-zinc-950"
          >
            {it}
          </span>
        ) : (
          <button
            key={it}
            type="button"
            onClick={() => onChange(it)}
            className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 tabular-nums hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            {it}
          </button>
        ),
      )}
      <PageButton
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        label="Next »"
      />
    </nav>
  );
}

function PageButton({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40 disabled:hover:bg-transparent disabled:dark:hover:bg-transparent"
    >
      {label}
    </button>
  );
}

// Standard windowed pagination: always show first + last; show current ±1;
// fill remaining gaps with a single "…" sentinel. For ≤7 pages, show all.
function paginationWindow(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  const sorted = [...pages].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push("…");
    out.push(sorted[i]);
  }
  return out;
}
