"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { useListboxNavigation } from "@/lib/hooks/useListboxNavigation";
import { useModalExit } from "@/lib/hooks/useModalExit";
import {
  FACULTIES,
  type Faculty,
  facultyLabel,
  type ProgramOption,
  splitProgramName,
} from "@/lib/programs";

interface Props {
  /** Full catalog to search; each option carries an optional `faculty`. */
  options: ProgramOption[];
  /** Currently-selected program ids (first = primary). */
  selected: string[];
  /** Add/remove a program id; the palette stays open for multi-add. */
  onToggle: (id: string) => void;
  /** Dismiss the palette (Done, Escape, X, or backdrop click). */
  onClose: () => void;
}

type FacultyFilter = Faculty | "all";

const TITLE_ID = "program-search-title";
const LISTBOX_ID = "program-search-listbox";
const optionId = (index: number) => `${LISTBOX_ID}-opt-${index}`;

/** An option pre-split for search + display, computed once per `options`. */
interface Entry {
  option: ProgramOption;
  title: string;
  degree?: string;
  faculty?: Faculty;
  /** Lowercased "title degree facultyLabel" haystack for free-text matching. */
  hay: string;
}

/** A filtered+sorted entry, tagged with whether it opens a new faculty group. */
interface Row extends Entry {
  isGroupStart: boolean;
}

/** Sort rank for a faculty (display order); unknown faculties sort last. */
function facultyRank(faculty: Faculty | undefined): number {
  if (!faculty) return FACULTIES.length;
  const i = FACULTIES.indexOf(faculty);
  return i === -1 ? FACULTIES.length : i;
}

/**
 * Searchable program picker rendered in the shared {@link Modal} shell: a
 * standard search box, a faculty-filter pill row, a faculty-grouped result list,
 * and a count/Done footer. Multi-select — toggling a row keeps it open.
 * Presentational over `ProgramMultiSelect` (`selected` + `onToggle`); query,
 * filter, and keyboard cursor are local UI.
 *
 * Renders with `Modal`'s `portal` because it opens from inside `PlanSettingsModal`,
 * whose `transform`-animated dialog box would otherwise trap this fixed overlay.
 */
export function ProgramSearchPalette({
  options,
  selected,
  onToggle,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [facultyFilter, setFacultyFilter] = useState<FacultyFilter>("all");
  // The "header detached" shadow under the filter pills once the list scrolls.
  const [scrolled, setScrolled] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);

  // Animated close + Escape, shared with every other modal via the Modal shell.
  const { isClosing, handleClose } = useModalExit(onClose);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Faculty pills, in display order, limited to faculties actually present.
  const faculties = useMemo(
    () => FACULTIES.filter((f) => options.some((o) => o.faculty === f)),
    [options],
  );

  // Split each option's name + build its search haystack once. `options` is
  // fixed for the palette's life, so this stays off the per-keystroke hot path.
  const entries = useMemo<Entry[]>(
    () =>
      options.map((option) => {
        const { title, degree } = splitProgramName(option.name);
        const label = option.faculty ? facultyLabel(option.faculty) : "";
        return {
          option,
          title,
          degree,
          faculty: option.faculty,
          hay: `${title} ${degree ?? ""} ${label}`.toLowerCase(),
        };
      }),
    [options],
  );

  // A student holds at most one academic plan per *subject*. The Honours /
  // Joint-Honours (and BCS / BMath) "variants" of e.g. Actuarial Science are
  // mutually-exclusive plan-types of one subject, not combinable plans — a joint
  // honours plan pairs with a plan in a *different* subject ("the joint plan must
  // be combined with another joint or honours plan", UW Math). So once any
  // variant of a subject is picked, its siblings become unpickable. Keyed on the
  // subject title (the program name minus its parenthetical) — the same
  // disambiguator must split on.
  // Source: https://uwaterloo.ca/combinatorics-and-optimization/undergraduates/degrees/joint-and-minor-combinatorics-and-optimization
  const takenSubjects = useMemo(() => {
    const taken = new Set<string>();
    for (const e of entries) {
      if (selectedSet.has(e.option.id)) taken.add(e.title);
    }
    return taken;
  }, [entries, selectedSet]);

  // Filter by faculty + free text, then sort by faculty (display order) then
  // name so each faculty's rows stay contiguous under one group header, tagging
  // each row that opens a new group.
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const matched = entries.filter((e) => {
      if (facultyFilter !== "all" && e.faculty !== facultyFilter) return false;
      return !q || e.hay.includes(q);
    });
    matched.sort((a, b) => {
      const fa = facultyRank(a.faculty);
      const fb = facultyRank(b.faculty);
      return fa !== fb ? fa - fb : a.option.name.localeCompare(b.option.name);
    });
    let lastFaculty: Faculty | undefined | null = null;
    return matched.map((e) => {
      const isGroupStart = e.faculty !== lastFaculty;
      lastFaculty = e.faculty;
      return { ...e, isGroupStart };
    });
  }, [entries, query, facultyFilter]);

  // Faculty-grouped rows for `role="group"` wrappers (rows are already
  // contiguous by faculty); carries each row's global index for the cursor.
  const groups = useMemo(() => {
    const out: {
      faculty: Faculty | undefined;
      rows: { row: Row; index: number }[];
    }[] = [];
    rows.forEach((row, i) => {
      if (i === 0 || row.isGroupStart) {
        out.push({ faculty: row.faculty, rows: [] });
      }
      out[out.length - 1].rows.push({ row, index: i });
    });
    return out;
  }, [rows]);

  // A row whose subject is already on the plan via a *different* program — i.e.
  // an unpickable sibling variant (the picked one itself stays toggleable).
  const isSubjectTaken = (row: Row) =>
    !selectedSet.has(row.option.id) && takenSubjects.has(row.title);

  // Keyboard cursor: ↑/↓ move it (skipping taken siblings), Enter toggles the
  // active row, and the active row scrolls into view. Home/End stay off so they
  // edit the search field.
  const { activeIndex, setActiveIndex, onKeyDown } = useListboxNavigation({
    count: rows.length,
    onSelect: (i) => {
      const row = rows[i];
      if (row && !isSubjectTaken(row)) onToggle(row.option.id);
    },
    isDisabled: (i) => {
      const row = rows[i];
      return !!row && isSubjectTaken(row);
    },
    scrollRef: listRef,
  });

  // On a result-set change (search/filter): cursor + scroll back to the top and
  // drop the header shadow. Called from the change handlers, not an effect — it's
  // a response to input, not to a rendered value.
  const resetListPosition = useCallback(() => {
    setActiveIndex(0);
    setScrolled(false);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [setActiveIndex]);

  const trimmedQuery = query.trim();

  return (
    <Modal
      portal
      isClosing={isClosing}
      onClose={handleClose}
      titleId={TITLE_ID}
      // The search box autofocuses, so keep the backdrop out of tab order.
      backdropTabIndex={-1}
      className="max-w-[560px] max-h-[calc(100vh-120px)]"
    >
      <ModalHeader titleId={TITLE_ID} onClose={handleClose}>
        Add a program
      </ModalHeader>

      {/* Search */}
      <div className="flex-none px-4 pt-3 pb-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            resetListPosition();
          }}
          onKeyDown={onKeyDown}
          autoFocus
          aria-label="Search programs"
          placeholder="Search all programs…"
          // Combobox wiring: focus stays here while ↑/↓ move a cursor through the
          // listbox below, so point AT at the active option for screen readers.
          role="combobox"
          aria-controls={LISTBOX_ID}
          aria-expanded={rows.length > 0}
          aria-activedescendant={
            rows.length > 0 ? optionId(activeIndex) : undefined
          }
        />
      </div>

      {/* Faculty filter (pills) */}
      <div
        className={`flex-none transition-shadow ${
          scrolled ? "shadow-[0_9px_11px_-9px_rgba(28,24,14,0.22)]" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-1.5 border-b border-line px-4 pt-1 pb-2.5">
          <FacultyPill
            label="All"
            active={facultyFilter === "all"}
            onClick={() => {
              setFacultyFilter("all");
              resetListPosition();
            }}
          />
          {faculties.map((f) => (
            <FacultyPill
              key={f}
              label={facultyLabel(f)}
              active={facultyFilter === f}
              onClick={() => {
                setFacultyFilter(f);
                resetListPosition();
              }}
            />
          ))}
        </div>
      </div>

      {/* Grouped, scrollable results */}
      <div
        ref={listRef}
        id={LISTBOX_ID}
        role="listbox"
        aria-label="Programs"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-1.5"
      >
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13.5px] text-ink-3">
            No programs match “{trimmedQuery}”.
          </div>
        ) : (
          groups.map((group) => {
            const groupLabel = group.faculty
              ? facultyLabel(group.faculty)
              : "Other";
            return (
              // biome-ignore lint/a11y/useSemanticElements: a listbox-owned grouping uses role="group"; a <fieldset> would be invalid inside role="listbox".
              <div
                key={group.faculty ?? "other"}
                role="group"
                aria-label={groupLabel}
              >
                {/* Visual header; the group's aria-label carries it to AT. */}
                <div
                  aria-hidden="true"
                  className="px-3 pt-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3"
                >
                  {groupLabel}
                </div>
                {group.rows.map(({ row, index }) => {
                  const isSelected = selectedSet.has(row.option.id);
                  const taken = isSubjectTaken(row);
                  const isActive = index === activeIndex;
                  return (
                    <button
                      key={row.option.id}
                      id={optionId(index)}
                      type="button"
                      role="option"
                      data-nav-index={index}
                      aria-selected={isSelected}
                      disabled={taken}
                      onClick={() => onToggle(row.option.id)}
                      onMouseEnter={
                        taken ? undefined : () => setActiveIndex(index)
                      }
                      className={`flex w-full items-center gap-3 rounded-[9px] px-3 py-[9px] text-left transition-colors ${
                        taken
                          ? "cursor-not-allowed opacity-45"
                          : isActive
                            ? "bg-bg-2"
                            : ""
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <span
                          className={`text-[14px] font-semibold ${
                            isSelected ? "text-accent" : "text-ink"
                          }`}
                        >
                          {row.title}
                        </span>
                        {row.degree ? (
                          <span className="truncate text-[12.5px] text-ink-3">
                            {row.degree}
                          </span>
                        ) : null}
                      </span>
                      {isSelected ? (
                        <Icon
                          name="check"
                          size="sm"
                          className="flex-none text-accent"
                          aria-hidden="true"
                        />
                      ) : taken ? (
                        <span className="flex-none text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                          Added
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-none items-center justify-between gap-2 border-t border-line bg-bg-2 px-4 py-3">
        <span className="text-[12.5px] text-ink-3">
          {selected.length} selected
        </span>
        <Button variant="primary" size="sm" onClick={handleClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

/** One pill in the faculty filter row. */
function FacultyPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-none whitespace-nowrap rounded-[9px] border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
        active
          ? "border-accent-line bg-accent-soft text-accent"
          : "border-line text-ink-2 hover:bg-bg-2 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
