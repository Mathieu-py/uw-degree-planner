import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock pdfjs-dist so extractTextFromPdf never loads the real ~500KB lib or a
// worker. getDocumentMock is reassigned per test to shape numPages / pages.
const { getDocumentMock } = vi.hoisted(() => ({ getDocumentMock: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: getDocumentMock,
}));

import { assembleLines, extractTextFromPdf } from "../pdfText";

function fakePdf(file: { type?: string; name?: string; size?: number }): File {
  // A minimal File stand-in: extractTextFromPdf only reads type/name/size and
  // calls arrayBuffer(). Construct a real File so those getters behave.
  const f = new File(
    [new Uint8Array(file.size ?? 1024)],
    file.name ?? "t.pdf",
    {
      type: file.type ?? "application/pdf",
    },
  );
  return f;
}

function fakeDoc(numPages: number, lineFactory: (page: number) => string[]) {
  return {
    numPages,
    getPage: vi.fn(async (n: number) => ({
      getTextContent: async () => ({
        // Each "line" becomes one text item on its own y-row.
        items: lineFactory(n).map((str, i) => ({
          str,
          transform: [1, 0, 0, 1, 0, 1000 - i * 10],
        })),
      }),
    })),
    destroy: vi.fn(async () => {}),
  };
}

// pdfjs's TextItem transform is [scaleX, skewY, skewX, scaleY, translateX, translateY].
// We only read indexes 4 and 5 (x, y). Synthetic items below use the same shape.
const item = (str: string, x: number, y: number) => ({
  str,
  transform: [1, 0, 0, 1, x, y],
});

describe("assembleLines", () => {
  it("groups items with the same y-coordinate into one line, ordered by x", () => {
    const out = assembleLines([
      item("Calculus", 100, 500),
      item("SYDE", 50, 500),
      item("111", 80, 500),
      item("1", 200, 500),
    ]);
    expect(out).toEqual(["SYDE 111 Calculus 1"]);
  });

  it("emits rows top-to-bottom (PDF y grows upward, so higher y first)", () => {
    const out = assembleLines([
      item("bottom", 0, 100),
      item("top", 0, 500),
      item("middle", 0, 300),
    ]);
    expect(out).toEqual(["top", "middle", "bottom"]);
  });

  it("absorbs sub-pixel y-jitter into the same row (tolerance ~2 units)", () => {
    // Cells on the same visual row may have y differing by a fraction.
    const out = assembleLines([
      item("SYDE", 50, 500.4),
      item("111", 80, 499.8),
    ]);
    expect(out).toEqual(["SYDE 111"]);
  });

  it("ignores empty-string and whitespace-only items", () => {
    const out = assembleLines([
      item("SYDE", 50, 500),
      item("", 60, 500),
      item("   ", 70, 500),
      item("111", 80, 500),
    ]);
    expect(out).toEqual(["SYDE 111"]);
  });

  it("returns an empty list for empty input", () => {
    expect(assembleLines([])).toEqual([]);
  });
});

describe("extractTextFromPdf", () => {
  beforeEach(() => {
    getDocumentMock.mockReset();
  });

  it("rejects a non-PDF file before loading pdfjs", async () => {
    await expect(
      extractTextFromPdf(fakePdf({ type: "text/plain", name: "t.txt" })),
    ).rejects.toThrow(/Not a PDF/);
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it("rejects a file over the size limit", async () => {
    await expect(
      extractTextFromPdf(fakePdf({ size: 6 * 1024 * 1024 })),
    ).rejects.toThrow(/too large/);
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it("rejects a PDF with too many pages and still destroys the doc", async () => {
    const doc = fakeDoc(51, () => ["line"]);
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(doc) });
    await expect(extractTextFromPdf(fakePdf({}))).rejects.toThrow(
      /too many pages/,
    );
    expect(doc.getPage).not.toHaveBeenCalled();
    expect(doc.destroy).toHaveBeenCalled();
  });

  it("extracts assembled text from a small PDF", async () => {
    const doc = fakeDoc(2, (page) => [`PAGE ${page} A`, `PAGE ${page} B`]);
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(doc) });
    const text = await extractTextFromPdf(fakePdf({}));
    expect(text).toContain("PAGE 1 A");
    expect(text).toContain("PAGE 2 B");
    expect(doc.destroy).toHaveBeenCalled();
  });

  it("throws when the PDF yields no text", async () => {
    const doc = fakeDoc(1, () => []);
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(doc) });
    await expect(extractTextFromPdf(fakePdf({}))).rejects.toThrow(
      /Couldn't read any text/,
    );
  });
});
