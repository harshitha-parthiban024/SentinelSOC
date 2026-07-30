import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, ShieldQuestion, ThumbsDown, ArrowUpRight } from "lucide-react";
import type { SocState } from "@/lib/soc/types";
import { AUTONOMY_LABELS } from "@/lib/soc/types";
import { fetchSocState, pct, severityClass, socControl, time } from "@/lib/soc/client";

export const Route = createFileRoute("/queue")({
  head: () => ({
    meta: [
      { title: "Human Review Queue — Agentic Incident Response" },
      {
        name: "description",
        content:
          "Calibrated hand-off queue: incidents where agent confidence fell below the gate threshold await analyst approval, rejection or escalation.",
      },
      { property: "og:title", content: "Human Review Queue — Agentic Incident Response" },
      {
        property: "og:description",
        content: "Analyst decisions on agent-proposed containment actions, with agreeing and conflicting evidence.",
      },
    ],
  }),
  component: QueuePage,
});

function QueuePage() {
  const [state, setState] = useState<SocState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetchSocState().then(setState).catch(() => undefined);
  }, []);

  async function decide(incidentId: string, decision: "approve" | "reject" | "escalate") {
    setBusy(incidentId);
    try {
      setState(await socControl({ action: "review", incidentId, decision }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <header className="panel p-4">
        <h1 className="text-lg font-bold text-foreground">Human review queue</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Everything the calibration gate refused to auto-execute lands here. Each decision updates the trust
          metrics that feed future autonomy levels.
        </p>
        {state && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Pending" value={String(state.queue.length)} />
            <Metric label="Auto-executed" value={String(state.trust.autoExecuted)} />
            <Metric label="Trust score" value={pct(state.trust.trustScore)} />
            <Metric label="Calibration acc." value={pct(state.trust.calibrationAccuracy)} />
          </div>
        )}
      </header>

      {state?.queue.length === 0 && (
        <div className="panel flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <ShieldQuestion className="size-4" /> Queue is empty — run a sweep from the console.
        </div>
      )}

      {state?.queue.map((item) => (
        <article key={item.incidentId} className="panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${severityClass[item.incident.severity]}`}
                >
                  {item.incident.severity}
                </span>
                <h2 className="text-sm font-bold text-foreground">{item.title}</h2>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {item.incidentId} · {item.incident.owasp} · queued {time(item.timestamp)}
              </p>
            </div>
            <div className="text-right text-[11px]">
              <p className="text-medium">Confidence {pct(item.confidence)}</p>
              <p className="text-agent">{AUTONOMY_LABELS[item.autonomy]}</p>
            </div>
          </div>

          <p className="mt-3 rounded-md border border-border/70 bg-surface-2/60 p-3 text-xs text-foreground/90">
            <span className="font-bold text-agent">Proposed action:</span> {item.proposedAction}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.report}</p>

          <div className="mt-3 grid gap-3 text-[11px] md:grid-cols-2">
            <div>
              <p className="mb-1 uppercase tracking-wider text-muted-foreground">Agreeing</p>
              <ul className="space-y-1">
                {item.supporting.map((s) => (
                  <li key={s.name} className="rounded border border-critical/30 bg-critical/5 p-1.5">
                    <span className="font-medium text-foreground/90">{s.name}</span> — {s.detail}
                  </li>
                ))}
                {item.supporting.length === 0 && <li className="text-muted-foreground">None.</li>}
              </ul>
            </div>
            <div>
              <p className="mb-1 uppercase tracking-wider text-muted-foreground">Conflicting</p>
              <ul className="space-y-1">
                {item.conflicting.map((s) => (
                  <li key={s.name} className="rounded border border-ok/30 bg-ok/5 p-1.5">
                    <span className="font-medium text-foreground/90">{s.name}</span> — {s.detail}
                  </li>
                ))}
                {item.conflicting.length === 0 && <li className="text-muted-foreground">None.</li>}
              </ul>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              disabled={busy === item.incidentId}
              onClick={() => decide(item.incidentId, "approve")}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <CheckCircle2 className="size-3.5" /> Approve & execute
            </button>
            <button
              disabled={busy === item.incidentId}
              onClick={() => decide(item.incidentId, "reject")}
              className="inline-flex items-center gap-1.5 rounded-md border border-critical/60 px-3 py-1.5 text-xs font-bold text-critical hover:bg-critical/10 disabled:opacity-50"
            >
              <ThumbsDown className="size-3.5" /> Reject
            </button>
            <button
              disabled={busy === item.incidentId}
              onClick={() => decide(item.incidentId, "escalate")}
              className="inline-flex items-center gap-1.5 rounded-md border border-medium/60 px-3 py-1.5 text-xs font-bold text-medium hover:bg-medium/10 disabled:opacity-50"
            >
              <ArrowUpRight className="size-3.5" /> Escalate to tier 2
            </button>
          </div>
        </article>
      ))}

      {state && state.outcomes.length > 0 && (
        <section className="panel p-4">
          <h2 className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Recent outcomes</h2>
          <ul className="space-y-1 text-xs">
            {state.outcomes.map((o) => (
              <li key={o.incidentId + o.timestamp} className="flex flex-wrap gap-2 border-b border-border/50 py-1">
                <span className="text-muted-foreground">{time(o.timestamp)}</span>
                <span className="font-medium text-foreground/90">{o.title}</span>
                <span className="text-agent">{o.resolution.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground">L{o.autonomy} · {pct(o.confidence)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-surface-2/60 p-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}
