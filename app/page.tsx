import { Suspense } from "react";
import { AuthErrorNotice } from "@/components/auth/AuthErrorNotice";
import { SiteFooter } from "@/components/chrome/SiteFooter";
import { Features } from "@/components/marketing/Features";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";

export default function Home() {
  return (
    <div className="flex flex-col">
      <Suspense fallback={null}>
        <AuthErrorNotice />
      </Suspense>
      <Hero />
      <HowItWorks />
      <Features />
      <SiteFooter />
    </div>
  );
}
