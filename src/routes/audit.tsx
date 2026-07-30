import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import type { NistFunction, SocState } from "@/lib/soc/types";
import { fetchSocState, time } from "@/lib/soc/client";

const NIST: { id: NistFunction; blurb: string }[] = [
  { id: "GOVERN", blurb: "Oversight controls: kill switch, autonomy caps, policy changes." },
  { id: "MAP", blurb: "Context: which target was probed, what the agents were tasked with." },
  { id: "MEASURE", blurb: "Confidence, calibration and escalation events." },
  { id: "MANAGE", blurb: "Actions taken — autonomous or human-approved." },
];

const actorClass: Record<string, string> = {
  agent: "text-agent border-agent/40 bg-agent/10",
  analyst: "text-ok border-ok/40 bg-ok/10",
  system: "text-medium border-medium/40 bg-medium/10",
};

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit Trail & NIST AI RMF Governance" },
      {
        name: "description",
        content:
          "Immutable audit trail of every agent and analyst action, mapped to the NIST AI Risk Management Framework functions GOVERN, MAP, MEASURE and MANAGE.",
      },
      { property: "og:title", content: "Audit Trail & NIST AI RMF Governance" },
      {
        property: "og:description",
        content: "Every autonomous and human decision logged and mapped to NIST AI RMF functions.",
      },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const [state, setState] = useState<SocState | null>(null);
  const [filter, setFilter] = useState<NistFunction | "ALL">("ALL");

  useEffect(() => {
    fetchSocState().then(setState).catch(() => undefined);
  }, []);

  const entries = useMemo(
    () => (state?.audit ?? []).filter((e) => filter === "ALL" || e.nist === filter),
    [state, filter],
  );

  function exportLog() {
    if (!state) return;
    const blob = new Blob([JSON.stringify(state.audit, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `soc-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <header className="panel p-4">
        <h1 className="text-lg font-bold text-foreground">Audit trail & NIST AI RMF governance</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Every agent action, gate decision, analyst verdict and kill-switch event is appended here and tagged with
          the NIST AI Risk Management Framework function it evidences.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {NIST.map((n) => {
            const count = state?.audit.filter((e) => e.nist === n.id).length ?? 0;
            return (
              <button
                key={n.id}
                onClick={() => setFilter(filter === n.id ? "ALL" : n.id)}
                className={`rounded-md border p-2 text-left transition-colors ${
                  filter === n.id ? "border-primary bg-primary/10" : "border-border/70 bg-surface-2/60 hover:border-primary/50"
                }`}
              >
                <p className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-foreground">
                  {n.id} <span className="text-primary">{count}</span>
                </p>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{n.blurb}</p>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setFilter("ALL")}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Show all
          </button>
          <button
            onClick={exportLog}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Download className="size-3.5" /> Export JSON
          </button>
        </div>
      </header>

      <section className="panel p-4">
        <h2 className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          {entries.length} entries {filter !== "ALL" && `· ${filter}`}
        </h2>
        <ol className="space-y-1.5 text-xs">
          {entries.map((e) => (
            <li key={e.id} className="rounded-md border border-border/60 bg-surface-2/50 p-2">
              <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider">
                <span className="text-muted-foreground">{time(e.timestamp)}</span>
                <span className={`rounded border px-1.5 py-0.5 font-bold ${actorClass[e.actor]}`}>{e.actorName}</span>
                <span className="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">{e.action}</span>
                <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">{e.nist}</span>
              </div>
              <p className="mt-1 leading-relaxed text-foreground/90">{e.detail}</p>
            </li>
          ))}
          {entries.length === 0 && <li className="text-muted-foreground">No entries yet.</li>}
        </ol>
      </section>
    </div>
  );
}
