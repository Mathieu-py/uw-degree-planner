import path from "node:path";
import { defineConfig } from "vitest/config";

// Production builds run *.svg imports through @svgr/webpack (see
// next.config.ts) so they resolve to React components. Vitest doesn't run
// that loader, so by default it would import each .svg as a data-URL string —
// JSX then tries to use the string as an element type, which JSDOM rejects
// with "InvalidCharacterError ... did not match the Name production". Stub
// each .svg as a tiny React component so <Icon> renders cleanly in tests.
export default defineConfig({
  plugins: [
    {
      name: "svg-as-stub",
      enforce: "pre",
      load(id: string) {
        if (id.endsWith(".svg")) {
          return (
            'import { createElement, forwardRef } from "react";\n' +
            "const SvgStub = forwardRef(function SvgStub(props, ref) {\n" +
            '  return createElement("svg", { ...props, ref });\n' +
            "});\n" +
            "export default SvgStub;\n"
          );
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "e2e/**"],
  },
});
