// Decorative miniature of the real planner for the landing hero — a term-card
// schedule on the left and the degree audit on the right, mirroring the live
// two-pane layout. Built from the .mp-* classes in globals.css; reuses the real
// Ring + Icon + tokens so it stays in sync. aria-hidden: no info for a screen
// reader.

import { Icon } from "@/components/ui/Icon";
import { Ring } from "@/components/ui/Ring";

type Term = { label: string; done: boolean; slots: string[] };

const PLACEHOLDER = "+ add";

const TERMS: Term[] = [
  {
    label: "1A · F23",
    done: true,
    slots: ["MATH 115", "SYDE 101", "PHYS 115"],
  },
  { label: "1B · W24", done: true, slots: ["MATH 116", "SYDE 121", "CHE 102"] },
  { label: "2A · F24", done: false, slots: ["SYDE 211", "SYDE 223", PLACEHOLDER] },
  { label: "2B · W25", done: false, slots: ["SYDE 252", PLACEHOLDER, PLACEHOLDER] },
];

type ReqState = "met" | "partial" | "missing";

const REQS: Array<{
  state: ReqState;
  label: string;
  count: string;
  met?: boolean;
}> = [
  { state: "met", label: "Mathematics", count: "Met", met: true },
  { state: "partial", label: "Nat. science", count: "2/3" },
  { state: "missing", label: "Compl. studies", count: "0/2" },
  { state: "partial", label: "Tech. electives", count: "3/5" },
];

const OVERALL_PCT = 62;

export function MiniPlanner() {
  return (
    <div className="mp" aria-hidden="true">
      <div className="mp-body">
        {/* Left: term-by-term schedule */}
        <div className="mp-sched">
          <span className="mp-cap">Your plan · 8 terms</span>
          <div className="mp-terms">
            {TERMS.map((t) => (
              <div className="mp-term" key={t.label}>
                <span className="mp-term-h">{t.label}</span>
                {t.slots.map((code, i) =>
                  code === PLACEHOLDER ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
                    <span key={i} className="mp-cslot mp-cslot-ghost">
                      {PLACEHOLDER}
                    </span>
                  ) : (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
                      key={i}
                      className={`mp-cslot ${t.done ? "mp-cslot-done" : ""}`}
                    >
                      <span>{code}</span>
                      {t.done ? (
                        <Icon
                          name="check"
                          size="xs"
                          className="mp-ck"
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                  ),
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: the degree audit in miniature */}
        <div className="mp-aud">
          <div className="mp-aud-top">
            <span className="mp-ring">
              <Ring pct={OVERALL_PCT} size={50} />
              <span className="mp-ring-num">{OVERALL_PCT}</span>
            </span>
            <div className="mp-aud-h">
              <span className="mp-aud-title">Degree audit</span>
              <span className="mp-aud-sub">{OVERALL_PCT}% complete</span>
            </div>
          </div>
          <div className="mp-aud-rows">
            {REQS.map((r) => (
              <div className="mp-arow" key={r.label}>
                <span className={`sdot sdot-${r.state}`} />
                <span className="mp-arow-lb">{r.label}</span>
                <span className={`mp-arow-ct ${r.met ? "mp-arow-ct-met" : ""}`}>
                  {r.count}
                </span>
              </div>
            ))}
          </div>
          <div className="mp-bar">
            <span style={{ width: `${OVERALL_PCT}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
