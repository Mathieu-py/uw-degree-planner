import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";

/**
 * The gold chevron used by every dropdown trigger. Rotates from pointing-left
 * (closed) to pointing-down (open) so the affordance reads the same on the
 * {@link ActionMenu} command menus, the {@link Picker} value selectors, and the
 * inline plan switcher.
 */
export function DropdownChevron({ open }: { open: boolean }) {
  return (
    <Icon
      name="chevronDown"
      size="xs"
      aria-hidden="true"
      className={`opacity-70 transition-transform ${open ? "" : "-rotate-90"}`}
    />
  );
}

interface SurfaceProps {
  id?: string;
  role?: "menu" | "listbox";
  "aria-label"?: string;
  "aria-activedescendant"?: string;
  /** Positioning + width overrides (e.g. `right-0`, `w-64`). */
  className?: string;
  children: ReactNode;
}

/**
 * The popover panel shared by {@link ActionMenu} and {@link Picker}: the
 * hairline-bordered, shadowed card that floats below a trigger. Owns only the
 * surface styling — anchor it inside a `relative` container and pass `className`
 * for alignment/width. Callers supply the `role` (`menu` vs `listbox`) and the
 * matching rows.
 */
export function DropdownSurface({
  className = "",
  children,
  ...aria
}: SurfaceProps) {
  return (
    <div
      {...aria}
      className={`absolute top-full mt-1 z-20 rounded-[10px] border border-line bg-bg shadow-card-md py-1 ${className}`.trim()}
    >
      {children}
    </div>
  );
}
