import { pathToFileURL } from "node:url";

/**
 * True when the calling module is the process entry point (`tsx foo.ts`), false
 * when it's imported (e.g. by a test). Lets a script export helpers yet run its
 * `main()` only on direct invocation. Pass `import.meta.url` from the caller.
 */
export function isDirectInvocation(importMetaUrl: string): boolean {
  return (
    process.argv[1] != null &&
    importMetaUrl === pathToFileURL(process.argv[1]).href
  );
}
