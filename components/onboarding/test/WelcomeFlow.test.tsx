// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Isolate the component from the router, auth, plan sync, and the heavy
// PDF/transcript pipeline so the drop wiring is what's under test.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/auth/store", () => ({
  useAuthState: () => ({ isAuthed: false }),
}));
vi.mock("@/lib/plan/sync/usePlanList", () => ({
  usePlanList: () => ({ create: vi.fn() }),
}));
vi.mock("@/lib/transcript/pdfText", () => ({ extractTextFromPdf: vi.fn() }));
vi.mock("@/lib/transcript/parse", () => ({
  parseTranscript: vi.fn(() => ({
    detectedProgramId: null,
    detectedSpecializationSlug: null,
    detectedCurrentTerm: null,
    detectedSystemOfStudy: "regular",
    rawPlanText: null,
    courses: [],
    warnings: [],
  })),
}));
vi.mock("@/lib/plan/transcriptApply", () => ({
  applyTranscriptToPlan: () => ({ plan: {} }),
  detectStream: () => null,
}));
vi.mock("@/lib/plan/derive", () => ({ completedCoursesFromPlan: () => [] }));

import { extractTextFromPdf } from "@/lib/transcript/pdfText";
import { WelcomeFlow } from "../WelcomeFlow";

const PROGRAMS = [{ id: "se", name: "Systems Design" }];

function renderFlow() {
  render(<WelcomeFlow programOptions={PROGRAMS} />);
  const label = screen.getByText(/choose a pdf/i).closest("label");
  if (!label) throw new Error("dropzone label not found");
  return label;
}

describe("WelcomeFlow dropzone", () => {
  beforeEach(() => {
    vi.mocked(extractTextFromPdf).mockReset();
  });
  afterEach(cleanup);

  it("routes a dropped PDF through the same parse path as the picker", async () => {
    vi.mocked(extractTextFromPdf).mockResolvedValue("transcript text");
    const label = renderFlow();
    const file = new File(["%PDF"], "transcript.pdf", {
      type: "application/pdf",
    });

    fireEvent.drop(label, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(extractTextFromPdf).toHaveBeenCalledWith(file));
  });

  it("shows drag-active feedback on drag-over and clears it on leave", () => {
    const label = renderFlow();

    // classList matches exact tokens, so this targets the standalone
    // drag-active class — not the always-present `hover:bg-accent-soft`.
    fireEvent.dragOver(label);
    expect(label.classList.contains("bg-accent-soft")).toBe(true);

    fireEvent.dragLeave(label);
    expect(label.classList.contains("bg-accent-soft")).toBe(false);
  });

  it("rejects a non-PDF drop the same way the picker does", async () => {
    vi.mocked(extractTextFromPdf).mockRejectedValue(
      new Error("Not a PDF file. Upload a Quest unofficial transcript PDF."),
    );
    const label = renderFlow();
    const file = new File(["nope"], "notes.txt", { type: "text/plain" });

    fireEvent.drop(label, { dataTransfer: { files: [file] } });

    await waitFor(() =>
      expect(screen.getByText(/couldn't read that pdf/i)).toBeTruthy(),
    );
  });
});
