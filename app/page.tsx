import { Features } from "@/components/marketing/Features";
import { Footer } from "@/components/marketing/Footer";
import { Hero } from "@/components/marketing/Hero";
import { PlannerMock } from "@/components/marketing/PlannerMock";

export default function Home() {
  return (
    <div className="flex flex-col">
      <Hero />
      <PlannerMock />
      <Features />
      <Footer />
    </div>
  );
}
