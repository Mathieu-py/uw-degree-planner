// Decorative mini-planner for the landing hero — a static timeline + audit
// card built from the .mp-* classes in globals.css (no screenshot asset, stays
// in visual sync with the real planner). aria-hidden: carries no information a
// screen reader needs.

type SlotState = "done" | "plan" | "empty";

const TERMS: Array<{ label: string; slots: Array<[string, SlotState]> }> = [
  {
    label: "1A · F23",
    slots: [
      ["MATH 115", "done"],
      ["SYDE 101", "done"],
      ["PHYS 115", "done"],
    ],
  },
  {
    label: "1B · W24",
    slots: [
      ["MATH 116", "done"],
      ["SYDE 121", "done"],
      ["CHE 102", "done"],
    ],
  },
  {
    label: "2A · F24",
    slots: [
      ["SYDE 211", "plan"],
      ["SYDE 223", "plan"],
      ["", "empty"],
    ],
  },
  {
    label: "2B · W25",
    slots: [
      ["SYDE 252", "plan"],
      ["", "empty"],
      ["", "empty"],
    ],
  },
];

const AUDIT: Array<[string, "met" | "partial" | "missing"]> = [
  ["Mathematics", "met"],
  ["Natural science", "partial"],
  ["Complementary studies", "missing"],
  ["Technical electives", "partial"],
];

export function MiniPlanner() {
  return (
    <div className="mp" aria-hidden="true">
      <div className="mp-chrome">
        <span className="mp-dot" style={{ background: "#e06b5e" }} />
        <span className="mp-dot" style={{ background: "#e0a21a" }} />
        <span className="mp-dot" style={{ background: "#2fae6a" }} />
        <span className="u-mono u-small ml-2 text-[11px]">
          Systems Design Engineering
        </span>
      </div>
      <div className="mp-grid">
        {TERMS.map((t) => (
          <div className="mp-col" key={t.label}>
            <span className="mp-collabel">{t.label}</span>
            {t.slots.map(([code, st], i) =>
              st === "empty" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
                <span key={i} className="mp-slot mp-slot-empty">
                  + add
                </span>
              ) : (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
                  key={i}
                  className={`mp-slot ${st === "done" ? "mp-slot-done" : ""}`}
                >
                  {code}
                </span>
              ),
            )}
          </div>
        ))}
      </div>
      <div className="mp-audit">
        <div className="mp-audit-head">
          <span className="mp-audit-title">Degree audit</span>
          <span className="mp-audit-pct">62% complete</span>
        </div>
        <div className="mp-bar">
          <span style={{ width: "62%" }} />
        </div>
        <div className="mp-audit-rows">
          {AUDIT.map(([label, st]) => (
            <div className="mp-audit-row" key={label}>
              <span className={`sdot sdot-${st}`} />
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
