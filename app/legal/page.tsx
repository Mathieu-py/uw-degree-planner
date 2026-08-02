import { SiteFooter } from "@/components/chrome/SiteFooter";
import { Eyebrow } from "@/components/ui/Eyebrow";

export const metadata = {
  title: "Legal & privacy",
};

export default function LegalPage() {
  return (
    <>
      <div className="section flex-1">
        <div className="container-sm flex flex-col gap-7">
          <div className="flex flex-col gap-1">
            <Eyebrow>Legal &amp; privacy</Eyebrow>
            <h1 className="u-h1">The fine print</h1>
          </div>

          <div className="flex flex-col gap-8">
            <section className="flex flex-col gap-2">
              <h2 className="u-h3">Not official academic advice</h2>
              <p className="u-body">
                Plans, prerequisite checks, and requirement audits are
                best-effort readings of scraped calendar data. They can be
                incomplete, out of date, or wrong. Always verify your degree
                requirements with your academic advisor and the official
                Undergraduate Calendar before making enrollment decisions.
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="u-h3">
                Not affiliated with the University of Waterloo
              </h2>
              <p className="u-body">
                This is an independent, unofficial planning tool built by a
                student. It is not endorsed by, affiliated with, or supported by
                the University of Waterloo.
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="u-h3">Privacy</h2>
              <p className="u-body">
                With an account, we store your email address and your plans
                (plan names, course codes, terms, and coarse course outcomes
                such as credit earned or in progress — never your grades) in our
                database. Signed out, plans live only in your browser's local
                storage and never leave your device. Transcript PDFs are parsed
                entirely in your browser and are never uploaded. There are no
                ads and no third-party analytics; runtime errors are reported to
                an error-tracking service without personal data. You can
                permanently delete your account and every plan at any time from
                Settings.
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="u-h3">Data sources</h2>
              <p className="u-body">
                Course ratings and requisite prose come from{" "}
                <a
                  href="https://uwflow.com"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent hover:underline"
                >
                  UWFlow
                </a>
                . Course schedule and enrollment data are provided by the
                University of Waterloo Open Data API. Program requirements are
                derived from the UW Undergraduate Calendar. All of it remains
                subject to its providers' terms; snapshots shown here may lag
                the live sources.
              </p>
            </section>
          </div>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
