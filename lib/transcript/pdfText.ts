/**
 * Extract text from a Quest unofficial transcript PDF, client-side. Output
 * mimics the columnar layout `./parse.ts` expects: same-row items joined with
 * spaces, rows joined with `\n`.
 *
 * `pdfjs-dist` (~500 KB) is dynamic-imported since it's only needed when the
 * import modal opens.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Real transcripts are a few pages; cap high so a crafted PDF can't tie up the
// main thread.
const MAX_PAGES = 50;
const PARSE_TIMEOUT_MS = 15_000;
// Vertical jitter under this many pdf-units counts as the same row. Quest rows
// are ~10 units apart and sub-pixel rendering offsets y by <1, so 2 absorbs
// jitter without merging adjacent rows.
const ROW_Y_TOLERANCE = 2;

interface PdfTextItem {
  str: string;
  transform: number[];
}

export async function extractTextFromPdf(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (
    (file.type && file.type !== "application/pdf") ||
    (ext !== undefined && ext !== "pdf")
  ) {
    throw new Error(
      "Not a PDF file. Upload a Quest unofficial transcript PDF.",
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `PDF too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Quest transcripts are typically under 1 MB.`,
    );
  }

  // Dynamic so the ~500 KB pdfjs payload stays out of the initial bundle.
  // Legacy build: the modern one calls Promise.try/withResolvers unguarded,
  // crashing WebKit older than ~18.2; legacy bundles core-js polyfills.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Worker ships with the package; bundlers honoring `new URL(...,
  // import.meta.url)` copy it into the build output.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;

  try {
    if (doc.numPages > MAX_PAGES) {
      throw new Error(
        `PDF has too many pages (${doc.numPages}). Quest unofficial transcripts are only a few pages — make sure you uploaded the right file.`,
      );
    }
    const text = await withTimeout(extractAllPages(doc), PARSE_TIMEOUT_MS);
    if (text.trim().length === 0) {
      throw new Error(
        "Couldn't read any text from this PDF — it may be a scan/image. Try exporting the unofficial transcript directly from Quest.",
      );
    }
    return text;
  } finally {
    await doc.destroy();
  }
}

interface PdfDocLike {
  numPages: number;
  getPage(
    n: number,
  ): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
}

async function extractAllPages(doc: PdfDocLike): Promise<string> {
  const allLines: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    // Only TextItems carry str + transform; filter then narrow via cast (the
    // runtime check keeps it sound).
    const items: PdfTextItem[] = content.items
      .filter((it) => "str" in (it as object) && "transform" in (it as object))
      .map((it) => it as unknown as PdfTextItem);
    allLines.push(...assembleLines(items));
  }
  return allLines.join("\n");
}

// Reject if `promise` doesn't settle within `ms`. The pdfjs work keeps running
// but its result is discarded; the caller's `finally` destroys the doc.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out reading this PDF. Try a smaller file."));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Group items by y (rounded to ROW_Y_TOLERANCE), sort each group by x, join
 * space-delimited. Output mirrors the visual row layout the parser expects.
 * Exported for tests.
 */
export function assembleLines(items: PdfTextItem[]): string[] {
  const rows = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const y = Math.round(item.transform[5] / ROW_Y_TOLERANCE);
    let row = rows.get(y);
    if (!row) {
      row = [];
      rows.set(y, row);
    }
    row.push(item);
  }
  // PDF y-axis grows upward; sort descending so we emit top-of-page first.
  const sortedEntries = [...rows.entries()].sort(([a], [b]) => b - a);
  return sortedEntries.map(([, row]) => {
    row.sort((a, b) => a.transform[4] - b.transform[4]);
    return row
      .map((it) => it.str.trim())
      .filter(Boolean)
      .join(" ");
  });
}
