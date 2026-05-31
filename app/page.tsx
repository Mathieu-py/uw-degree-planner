import { SiteFooter } from "@/components/chrome/SiteFooter";
import { Features } from "@/components/marketing/Features";
import { Hero } from "@/components/marketing/Hero";

export default function Home() {
  return (
    <div className="flex flex-col">
      <Hero />
      <Features />
      <SiteFooter />
    </div>
  );
}
