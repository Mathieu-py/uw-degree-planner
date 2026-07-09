import type { SVGProps } from "react";
import Arrow from "./icons/arrow.svg";
import Bolt from "./icons/bolt.svg";
import Check from "./icons/check.svg";
import ChevronDown from "./icons/chevronDown.svg";
import ChevronRight from "./icons/chevronRight.svg";
import Close from "./icons/close.svg";
import Copy from "./icons/copy.svg";
import Delete from "./icons/delete.svg";
import Doc from "./icons/doc.svg";
import Edit from "./icons/edit.svg";
import External from "./icons/external.svg";
import Gear from "./icons/gear.svg";
import Google from "./icons/google.svg";
import Grid from "./icons/grid.svg";
import Grip from "./icons/grip.svg";
import Import from "./icons/import.svg";
import List from "./icons/list.svg";
import Lock from "./icons/lock.svg";
import PlusSign from "./icons/plusSign.svg";
import Rename from "./icons/rename.svg";
import Reset from "./icons/reset.svg";
import Search from "./icons/search.svg";
import Share from "./icons/share.svg";
import Shield from "./icons/shield.svg";
import Upload from "./icons/upload.svg";
import Warning from "./icons/warning.svg";

// name → component, camelCase names used via <Icon name="..." />. Each icon
// draws in its own viewBox; the wrapper just applies size + color.
const REGISTRY = {
  arrow: Arrow,
  bolt: Bolt,
  check: Check,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  close: Close,
  copy: Copy,
  delete: Delete,
  doc: Doc,
  duplicate: Copy,
  edit: Edit,
  external: External,
  gear: Gear,
  // Fixed-color brand mark — keeps its own fills (doesn't follow currentColor).
  google: Google,
  grid: Grid,
  grip: Grip,
  import: Import,
  list: List,
  lock: Lock,
  plusSign: PlusSign,
  rename: Rename,
  reset: Reset,
  search: Search,
  settings: Gear,
  share: Share,
  shield: Shield,
  upload: Upload,
  warning: Warning,
} as const;

export type IconName = keyof typeof REGISTRY;

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<IconSize, string> = {
  xs: "w-3 h-3",
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-6 h-6",
  xl: "w-8 h-8",
};

interface Props extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: IconSize;
}

/**
 * Single entry point for rendering any icon (registered in REGISTRY). Pass
 * `name` + optional `size` (default "md"). Color inherits via `currentColor`,
 * so wrap with a `text-…` class to recolor.
 */
export function Icon({ name, size = "md", className, ...rest }: Props) {
  const Component = REGISTRY[name];
  return (
    <Component
      className={`${SIZE_CLASS[size]} ${className ?? ""}`.trim()}
      {...rest}
    />
  );
}
