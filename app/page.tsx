import { SiteFooter } from "@/components/chrome/SiteFooter";
import { Features } from "@/components/marketing/Features";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";

export default function Home() {
  return (
    <div className="flex flex-col">
      <Hero />
      <HowItWorks />
      <Features />
      <SiteFooter />
    </div>
  );
}
