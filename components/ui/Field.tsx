import type { ReactNode } from "react";
import { useId } from "react";

interface FieldProps {
  label: string;
  /** Render-prop receives the id to wire onto the control (htmlFor ↔ id). */
  children: (id: string) => ReactNode;
  /** Optional helper or error text under the control. */
  hint?: ReactNode;
  className?: string;
}

/**
 * Labelled form-field wrapper matching the design's `.field` + `.field-label`.
 * The label is associated with the control via a generated id passed to the
 * render-prop child:
 *
 *   <Field label="Email">{(id) => <Input id={id} type="email" />}</Field>
 */
export function Field({ label, children, hint, className }: FieldProps) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`.trim()}>
      <label htmlFor={id} className="text-[12.5px] font-semibold text-ink-2">
        {label}
      </label>
      {children(id)}
      {hint ? <p className="text-[13px] text-ink-3">{hint}</p> : null}
    </div>
  );
}
