import { Eyebrow } from "@/components/ui/Eyebrow";

const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: "Multi-term timeline",
    body: "See your whole degree at once — every academic and co-op term laid out in order, with one-click slot placement.",
  },
  {
    title: "Live degree audit",
    body: "Hierarchical requirements from the official Undergraduate Calendar update as you place courses. Know exactly what's met, partial, and missing.",
  },
  {
    title: "Transcript import",
    body: "Bootstrap a plan from your Quest PDF in seconds. Parsed entirely in your browser — your transcript never leaves your device.",
  },
  {
    title: "Smart catalog picker",
    body: "Open an empty slot for courses filtered to what's offered, what you're eligible for, and what fits your program — UWFlow ratings included.",
  },
  {
    title: "Share links",
    body: "Send a read-only link to a friend or advisor so they can see your plan without an account.",
  },
  {
    title: "Multi-plan sidebar",
    body: "Signed in, keep several plans side by side — compare streams, majors, or what-if scenarios and switch between them instantly.",
  },
];

export function Features() {
  return (
    <section className="section border-t border-line">
      <div className="container-lg">
        <Eyebrow>What you get</Eyebrow>
        <h2 className="u-h2 mt-3">Everything in one planner</h2>
        <div className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex flex-col gap-2 bg-bg p-6">
              <h3 className="u-h3 text-[16px]">{f.title}</h3>
              <p className="u-body text-[14px]">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
