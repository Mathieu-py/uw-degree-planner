import { Eyebrow } from "@/components/ui/Eyebrow";
import { Pill } from "@/components/ui/Pill";
import { HeroCta } from "./HeroCta";
import { MiniPlanner } from "./MiniPlanner";

const PROOF = [
  "Official Undergraduate Calendar",
  "UWFlow ratings",
  "Parsed in your browser",
];

export function Hero() {
  return (
    <section className="section">
      <div className="container-lg grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Left: copy + CTAs */}
        <div className="flex flex-col gap-6">
          <Eyebrow>UWaterloo degree planner</Eyebrow>
          <h1 className="u-display">
            Plan every term of your degree on{" "}
            <span className="u-underline">one screen.</span>
          </h1>
          <p className="u-lede max-w-xl">
            Import your Quest transcript and get a full multi-term plan in
            seconds — every past course placed, requirements audited live, and
            prereq-aware picks from UWFlow.
          </p>
          <HeroCta />
          <p className="u-small">
            For UWaterloo undergrads — any program our catalog covers. No
            account needed to try it.
          </p>
        </div>

        {/* Right: decorative mini-planner */}
        <div className="hidden lg:block">
          <MiniPlanner />
        </div>
      </div>

      {/* Proof strip */}
      <div className="container-lg mt-12 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-6">
        <span className="u-small mr-1">Built on official sources</span>
        {PROOF.map((p) => (
          <Pill key={p}>{p}</Pill>
        ))}
      </div>
    </section>
  );
}
