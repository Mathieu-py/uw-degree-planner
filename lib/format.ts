export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

export function formatCourseCode(code: string): string {
  const m = code.toUpperCase().match(/^([A-Z]+)(\d+[A-Z]*)$/);
  return m ? `${m[1]} ${m[2]}` : code.toUpperCase();
}

/** Units as a compact string: trims trailing zeros (20.0→"20", 13.5→"13.5"). */
export function fmtUnits(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function truncate(text: string | null | undefined, max = 140): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}
