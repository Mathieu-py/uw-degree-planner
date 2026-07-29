import { SettingsView } from "@/components/SettingsView";
import { SettingsSkeleton } from "@/components/states/PageSkeleton";
import { AuthGate } from "@/lib/auth/store";

export const metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <AuthGate fallback={<SettingsSkeleton />}>
      <SettingsView />
    </AuthGate>
  );
}
