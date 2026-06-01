// Shared visual for text inputs and native selects — the design's `.input`.
// Kept in a plain module so both Input.tsx and Select.tsx build on one source
// of truth (mirrors how buttonClasses.ts backs Button.tsx). Focus shows a gold
// ring via the `--accent-soft` token.
export const FIELD_CLASSES =
  "h-[42px] w-full rounded-[9px] border border-line-2 bg-bg text-ink text-sm " +
  "placeholder:text-ink-3 outline-none transition-[border-color,box-shadow] " +
  "focus:border-accent-bg focus:shadow-[0_0_0_3px_var(--accent-soft)]";
