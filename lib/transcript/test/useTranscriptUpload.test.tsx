// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { extractTextFromPdfMock, parseTranscriptMock } = vi.hoisted(() => ({
  extractTextFromPdfMock: vi.fn(),
  parseTranscriptMock: vi.fn(),
}));
vi.mock("../pdfText", () => ({ extractTextFromPdf: extractTextFromPdfMock }));
vi.mock("../parse", () => ({ parseTranscript: parseTranscriptMock }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { useTranscriptUpload } from "../useTranscriptUpload";

// Tag the parse result by its input text so different uploads are distinguishable.
function tagged(text: string) {
  return { text } as unknown;
}

function file(name: string) {
  return new File(["x"], name, { type: "application/pdf" });
}

beforeEach(() => {
  vi.clearAllMocks();
  parseTranscriptMock.mockImplementation((text: string) => tagged(text));
});

describe("useTranscriptUpload", () => {
  it("commits fileName, parseResult, and onParsed on a successful parse", async () => {
    extractTextFromPdfMock.mockResolvedValue("TEXT-A");
    const onParsed = vi.fn();
    const { result } = renderHook(() => useTranscriptUpload(onParsed));

    await act(async () => {
      await result.current.onFile(file("a.pdf"));
    });

    expect(result.current.fileName).toBe("a.pdf");
    expect(result.current.parseResult).toEqual(tagged("TEXT-A"));
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
    expect(onParsed).toHaveBeenCalledExactlyOnceWith(tagged("TEXT-A"));
  });

  it("surfaces the extractor's message and leaves parseResult null on failure", async () => {
    extractTextFromPdfMock.mockRejectedValue(
      new Error("Not a PDF file. Upload a Quest unofficial transcript PDF."),
    );
    const onParsed = vi.fn();
    const { result } = renderHook(() => useTranscriptUpload(onParsed));

    await act(async () => {
      await result.current.onFile(file("x.pdf"));
    });

    expect(result.current.error).toBe(
      "Not a PDF file. Upload a Quest unofficial transcript PDF.",
    );
    expect(result.current.parseResult).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(onParsed).not.toHaveBeenCalled();
  });
});
