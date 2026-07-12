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
    detectedProgramIds: [],
    detectedSpecializationsByProgramId: {},
    detectedCurrentTerm: null,
    detectedSystemOfStudy: "regular",
    rawPlanText: null,
    courses: [],
    warnings: [],
  })),
}));
vi.mock("@/lib/plan/transcriptApply", () => ({
  applyTranscriptToPlan: () => ({
    plan: { programIds: [], specializationIds: {} },
  }),
  detectStream: () => null,
}));
vi.mock("@/lib/plan/derive", () => ({ completedCoursesFromPlan: () => [] }));
// The variant-picker server actions pull in server-only catalog code; stub them
// so the client component tree loads under jsdom (real Next keeps them RPC-only).
vi.mock("@/lib/onboarding/server/actions", () => ({
  fetchVariantGroups: vi.fn(async () => []),
  placeVariantSelections: vi.fn(async () => []),
}));

import {
  fetchVariantGroups,
  placeVariantSelections,
} from "@/lib/onboarding/server/actions";
import type { VariantGroup } from "@/lib/requirements/variantGroups";
import { parseTranscript } from "@/lib/transcript/parse";
import { extractTextFromPdf } from "@/lib/transcript/pdfText";
import { WelcomeFlow } from "../WelcomeFlow";

const PROGRAMS = [
  {
    id: "software-engineering",
    name: "Software Engineering",
    kind: "engineering" as const,
  },
  {
    id: "electrical-engineering",
    name: "Electrical Engineering",
    kind: "engineering" as const,
  },
];

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

function streamChecked(name: RegExp): string | null {
  return screen.getByRole("radio", { name }).getAttribute("aria-checked");
}

const INTRO_GROUP: VariantGroup = {
  programId: "software-engineering",
  key: "software-engineering:flex:0",
  termLabel: null,
  description: "Complete 1 of the following",
  selectMin: 1,
  selectMax: 1,
  options: ["cs115", "cs135", "cs145"],
};

describe("WelcomeFlow variant picker (#84)", () => {
  beforeEach(() => {
    vi.mocked(fetchVariantGroups).mockReset().mockResolvedValue([INTRO_GROUP]);
    vi.mocked(placeVariantSelections).mockReset().mockResolvedValue([]);
  });
  afterEach(cleanup);

  it("renders the manual picker and folds a chosen variant into the built plan", async () => {
    render(<WelcomeFlow programOptions={PROGRAMS} />);
    // Manual setup: pick a program, which fetches its pickable variant groups.
    fireEvent.click(screen.getByRole("button", { name: /add a program/i }));
    fireEvent.click(
      screen.getByRole("option", { name: /software engineering/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    await waitFor(() =>
      expect(fetchVariantGroups).toHaveBeenCalledWith(["software-engineering"]),
    );

    // Advance to Review — the picker only renders there, on the manual path.
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => screen.getByText("Course choices"));
    fireEvent.click(screen.getByText("CS 135"));

    // Building routes the selection through placement (server-side, prereq-aware).
    fireEvent.click(screen.getByRole("button", { name: /build my plan/i }));
    await waitFor(() =>
      expect(placeVariantSelections).toHaveBeenCalledWith(
        expect.objectContaining({
          programIds: ["software-engineering"],
          selections: [{ code: "cs135", termLabel: null }],
        }),
      ),
    );
  });
});

describe("WelcomeFlow default stream (#131)", () => {
  beforeEach(() => {
    vi.mocked(extractTextFromPdf).mockReset();
  });
  afterEach(cleanup);

  it("pre-fills the co-op stream from a manually picked program", () => {
    render(<WelcomeFlow programOptions={PROGRAMS} />);
    // Manual setup (step 0): add a Stream 8 program.
    fireEvent.click(screen.getByRole("button", { name: /add a program/i }));
    fireEvent.click(
      screen.getByRole("option", { name: /software engineering/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));

    expect(streamChecked(/stream 8 co-op/i)).toBe("true");
  });

  it("does not override a transcript-derived stream when the program is corrected", async () => {
    vi.mocked(extractTextFromPdf).mockResolvedValue("transcript text");
    // A parsed transcript that names a program keeps the flow on its detected
    // (here: regular) stream; correcting the program later must not re-suggest.
    vi.mocked(parseTranscript).mockReturnValueOnce({
      detectedProgramIds: ["electrical-engineering"],
      detectedSpecializationsByProgramId: {},
      detectedCurrentTerm: null,
      detectedSystemOfStudy: "regular",
      rawPlanText: null,
      courses: [],
      warnings: [],
    });
    const label = renderFlow();
    fireEvent.drop(label, {
      dataTransfer: {
        files: [new File(["%PDF"], "t.pdf", { type: "application/pdf" })],
      },
    });
    await waitFor(() =>
      screen.getByRole("button", { name: /remove electrical engineering/i }),
    );

    // Advance to Review and swap in a Stream 8 program.
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /remove electrical engineering/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /add a program/i }));
    fireEvent.click(
      screen.getByRole("option", { name: /software engineering/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));

    // parseResult guard holds: stream stays regular, not the SE default.
    expect(streamChecked(/^regular$/i)).toBe("true");
    expect(streamChecked(/stream 8 co-op/i)).toBe("false");
  });
});
