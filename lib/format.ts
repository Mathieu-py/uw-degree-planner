export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

export function formatCourseCode(code: string): string {
  const m = code.toUpperCase().match(/^([A-Z]+)(\d+[A-Z]*)$/);
  return m ? `${m[1]} ${m[2]}` : code.toUpperCase();
}

export function truncate(text: string | null | undefined, max = 140): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}
