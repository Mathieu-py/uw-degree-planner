const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: "Multi-term timeline",
    body: "See your whole degree at once — every academic and co-op term laid out in order, with drag-free slot placement.",
  },
  {
    title: "Live degree audit",
    body: "Hierarchical requirements from the official Undergraduate Calendar update as you place courses. Know exactly what's met, partial, and missing.",
  },
  {
    title: "Transcript import",
    body: "Bootstrap a plan from your Quest PDF in seconds. Parsed entirely in your browser — your transcript never leaves your device.",
  },
  {
    title: "Smart catalog picker",
    body: "Click an empty slot to get courses filtered to what's offered, what you're eligible for, and what fits your program — UWFlow ratings included.",
  },
  {
    title: "Share links",
    body: "Send a read-only link to a friend or advisor so they can see your plan without an account.",
  },
  {
    title: "Multi-plan sidebar",
    body: "Signed in, keep several plans side by side — compare streams, majors, or what-if scenarios and switch between them instantly.",
  },
];

export function Features() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16 border-t border-zinc-200 dark:border-zinc-800">
      <h2 className="text-2xl font-semibold tracking-tight">
        Everything in one planner
      </h2>
      <dl className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Feature key={f.title} title={f.title} body={f.body} />
        ))}
      </dl>
    </section>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
        {title}
      </dt>
      <dd className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
        {body}
      </dd>
    </div>
  );
}
