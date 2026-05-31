import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = {
  title: "Sign in — UW Degree Planner",
};

const REPO = "github.com/uw-degree-planner";
const PERKS = ["Live audit", "Transcript import", "Share links"];

export default function LoginPage() {
  return (
    <div className="flex flex-1">
      {/* Left: ink brand panel (desktop only). Fixed dark regardless of theme. */}
      <aside className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-[#17150f] text-[#f6f3ea] p-12">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] bg-[var(--gold)] font-mono text-xs font-bold text-[#1c1604]">
            W
          </span>
          <span className="text-[15px] font-bold tracking-tight">
            UW Degree Planner
          </span>
        </div>

        <div className="flex flex-col gap-6 max-w-md">
          <h2 className="text-[40px] font-bold leading-[1.05] tracking-[-0.03em]">
            Every term, every requirement —{" "}
            <span className="text-[var(--gold)]">in one place.</span>
          </h2>
          <p className="text-[15px] leading-relaxed text-[#aaa492]">
            Sign in to sync your plans across devices, keep multiple streams
            side by side, and share read-only links with your advisor.
          </p>
          <div className="flex flex-wrap gap-2">
            {PERKS.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#352f1f] px-3 py-1 text-xs font-medium text-[#aaa492]"
              >
                <Icon
                  name="check"
                  size="xs"
                  aria-hidden="true"
                  className="text-[var(--gold)]"
                />
                {p}
              </span>
            ))}
          </div>
        </div>

        <p className="font-mono text-xs text-[#726c5b]">Unofficial · {REPO}</p>
      </aside>

      {/* Right: form */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px]">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
