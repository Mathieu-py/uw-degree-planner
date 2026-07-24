import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/programs/registry", () => ({
  programNameMap: () => ({ se: "Software Engineering" }),
}));
// Stub the client view — we only inspect the wrapping the page renders.
vi.mock("@/components/DashboardView", () => ({
  DashboardView: () => null,
}));

import { DashboardView } from "@/components/DashboardView";
import { DashboardSkeleton } from "@/components/states/PageSkeleton";
import { AuthGate } from "@/lib/auth/store";
import PlansPage from "../page";

describe("PlansPage", () => {
  it("mounts the dashboard behind AuthGate with the page skeleton (anon-flash guard)", () => {
    const el = PlansPage();

    expect(el.type).toBe(AuthGate);
    expect(el.props.fallback.type).toBe(DashboardSkeleton);
    expect(el.props.children.type).toBe(DashboardView);
  });
});
