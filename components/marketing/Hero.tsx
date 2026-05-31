import Link from "next/link";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon } from "@/components/ui/Icon";
import { Pill } from "@/components/ui/Pill";
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
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/plan"
              className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-[10px] bg-primary text-primary-ink text-[15px] font-semibold hover:bg-primary-hover transition-colors"
            >
              Try the demo
              <Icon name="arrow" size="sm" aria-hidden="true" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center h-12 px-6 rounded-[10px] border border-line-2 bg-bg text-ink text-[15px] font-semibold hover:bg-bg-2 transition-colors"
            >
              Sign in
            </Link>
          </div>
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
