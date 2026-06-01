/**
 * Shared classes for the catalog add-flow's modal list buttons — the per-term
 * options ({@link TermOptionList}) and the signed-in plan picker
 * ({@link TermPickerAuthed}). Both are full-width left-aligned rows on a
 * hairline border that grey out when disabled.
 */
export const optionButtonClasses =
  "flex items-center justify-between gap-3 rounded-[9px] border border-line px-3 py-2.5 text-left transition-colors hover:bg-bg-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent";
