import { describe, expect, it, vi } from "vitest";

// Stub the client view — we only inspect the wrapping the page renders.
vi.mock("@/components/SettingsView", () => ({
  SettingsView: () => null,
}));

import { SettingsView } from "@/components/SettingsView";
import { SettingsSkeleton } from "@/components/states/PageSkeleton";
import { AuthGate } from "@/lib/auth/store";
import SettingsPage from "../page";

describe("SettingsPage", () => {
  it("mounts settings behind AuthGate with the page skeleton (anon-flash guard)", () => {
    const el = SettingsPage();

    expect(el.type).toBe(AuthGate);
    expect(el.props.fallback.type).toBe(SettingsSkeleton);
    expect(el.props.children.type).toBe(SettingsView);
  });
});
