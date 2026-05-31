import { Faq } from "@/components/marketing/Faq";
import { Features } from "@/components/marketing/Features";
import { Footer } from "@/components/marketing/Footer";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { PlannerMock } from "@/components/marketing/PlannerMock";

export default function Home() {
  return (
    <div className="flex flex-col">
      <Hero />
      <PlannerMock />
      <HowItWorks />
      <Features />
      <Faq />
      <Footer />
    </div>
  );
}
