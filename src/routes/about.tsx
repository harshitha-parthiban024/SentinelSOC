import { createFileRoute } from "@tanstack/react-router";
import { AUTONOMY_LABELS, CONFIDENCE_THRESHOLD } from "@/lib/soc/types";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "How It Works — Agentic Incident Response System" },
      {
        name: "description",
        content:
          "Design notes: orchestrator-led agent team, tiered autonomy L0-L4, kill switch, calibrated hand-off and NIST AI RMF audit logging over live passive reconnaissance.",
      },
      { property: "og:title", content: "How It Works — Agentic Incident Response System" },
      {
        property: "og:description",
        content: "Orchestrator, tiered autonomy, kill switch, calibration gate and NIST-mapped audit trail.",
      },
    ],
  }),
  component: About,
});

function About() {
  return (
    <div className="space-y-4">
      <header className="panel p-4">
        <h1 className="text-lg font-bold text-foreground">How this system works</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          There are no canned alerts. Every incident on the console is derived from live HTTP response metadata
          collected by passive GET probes against a public, intentionally-vulnerable test target. The agent team
          then triages, correlates, hunts, proposes a response and passes it through a calibration gate before any
          action is considered.
        </p>
      </header>

      <section className="panel p-4">
        <h2 className="text-sm font-bold text-foreground">Tiered autonomy scale</h2>
        <ul className="mt-2 space-y-1 text-xs">
          {([0, 1, 2, 3, 4] as const).map((l) => (
            <li key={l} className="rounded-md border border-border/60 bg-surface-2/50 p-2 text-foreground/90">
              {AUTONOMY_LABELS[l]}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The level granted per incident is a function of evidence confidence, severity, current queue depth, the
          global analyst cap, and the kill switch. Confidence below {Math.round(CONFIDENCE_THRESHOLD * 100)}% always
          routes to a human.
        </p>
      </section>

      <section className="panel p-4">
        <h2 className="text-sm font-bold text-foreground">Safety &amp; governance</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Kill switch pins every incident to L0 and logs each suppressed action.</li>
          <li>Analyst-set autonomy cap bounds the maximum level any agent can be granted.</li>
          <li>Immutable audit trail tags each event with a NIST AI RMF function.</li>
          <li>Trust metrics (approval rate, calibration accuracy) are recomputed from analyst verdicts.</li>
          <li>Reconnaissance is strictly passive — no exploitation payloads are ever sent.</li>
        </ul>
      </section>
    </div>
  );
}
