import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SVGR: import .svg files as React components so we can recolor via
  // `currentColor` (text-* classes) and size via `w-* h-*` like any inline
  // SVG. The `icon: true` SVGR option drops the SVG's intrinsic width/height
  // so size is fully controlled by Tailwind classes on the wrapper.
  turbopack: {
    rules: {
      "*.svg": {
        loaders: [
          {
            loader: "@svgr/webpack",
            options: { icon: true },
          },
        ],
        as: "*.js",
      },
    },
  },
};

export default nextConfig;
