import { NextResponse } from "next/server";
import { PROGRAMS } from "@/lib/programsRegistry";

// Serve one program's full detail (rule trees, electives, spec rules) so the
// client can load only the 1–2 programs on the active plan instead of bundling
// the ~2 MB registry. Prerendered per slug at build (force-static +
// generateStaticParams), so this is immutable data off a CDN, not runtime work.
export const dynamic = "force-static";

export function generateStaticParams(): { slug: string }[] {
  return Object.keys(PROGRAMS).map((slug) => ({ slug }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const program = PROGRAMS[slug];
  if (!program) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(program);
}
