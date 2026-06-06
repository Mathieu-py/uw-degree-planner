import { useCallback, useState } from "react";
import type { FilterPreset } from "@/lib/courses/types";

export interface PickerContext {
  slotId: string;
  focusCodes?: string[];
  /** Filters to pre-apply when the picker opens (e.g. a subject-pool Browse). */
  initialFilters?: FilterPreset;
}

/**
 * The planner's transient overlay state: picker target slot + modal/sheet
 * open flags. Pure UI state, kept apart from the shell's edit handlers.
 * `openPicker`/`closePicker` are stable (so memoized timeline columns don't
 * churn); `setPicker` is exposed for the audit drill-in's `focusCodes`.
 */
export function usePlannerModals() {
  const [picker, setPicker] = useState<PickerContext | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [auditSheetOpen, setAuditSheetOpen] = useState(false);

  const openPicker = useCallback((slotId: string) => {
    setPicker({ slotId });
  }, []);
  const closePicker = useCallback(() => setPicker(null), []);

  return {
    picker,
    setPicker,
    openPicker,
    closePicker,
    transcriptOpen,
    setTranscriptOpen,
    settingsOpen,
    setSettingsOpen,
    auditSheetOpen,
    setAuditSheetOpen,
  };
}
