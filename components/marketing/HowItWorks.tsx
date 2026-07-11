import { Eyebrow } from "@/components/ui/Eyebrow";

// Copy describes the app's actual audit: requirements come from the official
// Undergraduate Calendar and prereqs are satisfied by completion (no grades
// tracked) — keep it truthful if the audit behavior changes.
const STEPS: Array<{ n: string; title: string; body: string }> = [
  {
    n: "01",
    title: "Import your transcript",
    body: "Upload your Quest transcript PDF — it's parsed right in your browser and never uploaded. Every course you've taken lands in the right term automatically.",
  },
  {
    n: "02",
    title: "Plan every term",
    body: "Your whole degree, laid out — academic and co-op terms in order. Fill an empty slot from a catalog filtered to what's offered and what you're eligible to take.",
  },
  {
    n: "03",
    title: "Watch the audit",
    body: "Requirements from the official Undergraduate Calendar update as you place courses, flagging each met, partial, or missing. Prereqs are checked by completion — place a course before its prereqs and it's held out until they're met.",
  },
];

export function HowItWorks() {
  return (
    <section className="section border-t border-line">
      <div className="container-lg">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="u-h2 mt-3">From transcript to a live audit</h2>
        <div className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-[14px] border border-line bg-line md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="flex flex-col gap-2 bg-bg p-6">
              <span className="u-mono text-[13px] font-semibold text-accent">
                {s.n}
              </span>
              <h3 className="u-h3 text-[16px]">{s.title}</h3>
              <p className="u-body text-[14px]">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
