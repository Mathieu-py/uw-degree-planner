/**
 * Extract text from a Quest unofficial transcript PDF on the client. The
 * output is assembled to mimic the columnar layout the parser in
 * `./parse.ts` was tuned for: items on the same horizontal line are
 * concatenated with spaces, lines are joined with `\n`.
 *
 * `pdfjs-dist` is large (~500 KB minified) and only needed when the user
 * opens the transcript-import modal, so it is dynamic-imported. Callers
 * pay the network cost once, on first use.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Two pdf-units of vertical jitter still counts as the "same row". Quest's
// table rows are spaced ~10 units apart; sub-pixel rendering can offset the
// y by < 1 unit across cells, so a tolerance of 2 absorbs that without
// merging adjacent rows.
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

  // Dynamic so the ~500 KB pdfjs payload doesn't bloat the initial bundle.
  const pdfjs = await import("pdfjs-dist");
  // The worker file ships with the package; bundlers (Turbopack/webpack) that
  // honor `new URL(..., import.meta.url)` will copy it into the build output.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;

  try {
    const allLines: string[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      // content.items is (TextItem | TextMarkedContent)[]; only TextItems
      // carry str + transform. Filter, then narrow via cast — the runtime
      // check above keeps it sound.
      const items: PdfTextItem[] = content.items
        .filter((it) => "str" in it && "transform" in it)
        .map((it) => it as unknown as PdfTextItem);
      allLines.push(...assembleLines(items));
    }
    const text = allLines.join("\n");
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

/**
 * Group text items by y-coordinate (rounded to ROW_Y_TOLERANCE), sort each
 * group by x-coordinate, and concatenate as a single space-delimited line.
 * The output mirrors the visual row layout — which is what the line-based
 * transcript parser expects.
 *
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
