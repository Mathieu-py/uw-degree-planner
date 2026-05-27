import type { SVGProps } from "react";
import Check from "./icons/check.svg";
import Close from "./icons/close.svg";
import PlusSign from "./icons/plus-sign.svg";
import Settings from "./icons/settings.svg";

// Add new icons here as: name → component. Names are camelCase strings the
// rest of the app uses via <Icon name="..." />. Keep each icon component
// drawing in its own viewBox; the wrapper just applies size + color classes.
const REGISTRY = {
  check: Check,
  close: Close,
  plusSign: PlusSign,
  settings: Settings,
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
 * Single entry point for rendering any icon. SVG sources live in `./icons/`;
 * register each one in REGISTRY below. Pass
 * `name` plus an optional `size` (defaults to "md"). Color inherits from the
 * parent via `currentColor`, so wrap with a `text-…` class to recolor.
 *
 *   <Icon name="settings" size="md" />
 *   <button className="text-zinc-500 hover:text-zinc-50">
 *     <Icon name="settings" />
 *   </button>
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
