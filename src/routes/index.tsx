import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDot,
  Gauge,
  Play,
  Radar,
  ShieldAlert,
  UserCheck,
} from "lucide-react";
import type {
  AutonomyLevel,
  Incident,
  Outcome,
  ReconSnapshot,
  SocState,
  StageId,
  StageResult,
} from "@/lib/soc/types";
import { AUTONOMY_LABELS, CONFIDENCE_THRESHOLD } from "@/lib/soc/types";
import { fetchSocState, pct, severityClass, socControl, time } from "@/lib/soc/client";

const TARGETS = [
  { id: "juice-shop", label: "OWASP Juice Shop (public demo)", url: "https://demo.owasp-juice.shop" },
  { id: "ginandjuice", label: "Gin & Juice Shop (PortSwigger lab)", url: "https://ginandjuice.shop" },
];

const STAGES: { id: StageId; label: string }[] = [
  { id: "orchestrator", label: "Orchestrator" },
  { id: "recon", label: "Recon" },
  { id: "triage", label: "Triage" },
  { id: "correlation", label: "Correlation" },
  { id: "hunt", label: "Threat hunt" },
  { id: "response", label: "Response" },
  { id: "gate", label: "Calibration gate" },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Live SOC Console — Agentic Incident Response" },
      {
        name: "description",
        content:
          "Run a multi-agent incident response pipeline against a live public test target, with tiered autonomy, kill switch and calibrated human review.",
      },
      { property: "og:title", content: "Live SOC Console — Agentic Incident Response" },
      {
        property: "og:description",
        content:
          "Orchestrated agent team performing live passive recon, evidence calibration and governed autonomous response.",
      },
    ],
  }),
  component: Console,
});

type ResolvedRecord = {
  outcome: Outcome;
  hypothesis: string;
  report: string;
  aiGenerated: boolean;
  autonomyRationale: string[];
};

function Console() {
  const [targetId, setTargetId] = useState(TARGETS[0].id);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StageResult[]>([]);
  const [activeStage, setActiveStage] = useState<StageId | null>(null);
  const [snapshot, setSnapshot] = useState<ReconSnapshot | null>(null);
  const [incidents, setIncidents] = useState<{ incident: Incident; scored: Scored }[]>([]);
  const [resolved, setResolved] = useState<Record<string, ResolvedRecord>>({});
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<SocState | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetchSocState().then(setState).catch(() => undefined);
    return () => esRef.current?.close();
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [steps]);

  function startRun() {
    esRef.current?.close();
    setSteps([]);
    setIncidents([]);
    setResolved({});
    setSnapshot(null);
    setError(null);
    setRunning(true);

    const es = new EventSource(`/api/soc/run?target=${targetId}`);
    esRef.current = es;

    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "step") {
        setActiveStage(msg.stage);
        setSteps((prev) => [...prev, msg as StageResult]);
      } else if (msg.type === "recon") {
        setSnapshot(msg.snapshot);
      } else if (msg.type === "incident") {
        setIncidents((prev) => [...prev, { incident: msg.incident, scored: msg.scored }]);
      } else if (msg.type === "resolved") {
        setResolved((prev) => ({
          ...prev,
          [msg.outcome.title]: msg as ResolvedRecord,
        }));
      } else if (msg.type === "state") {
        setState(msg.state);
      } else if (msg.type === "error") {
        setError(msg.message);
      } else if (msg.type === "complete") {
        setRunning(false);
        setActiveStage(null);
        es.close();
      }
    };

    es.onerror = () => {
      setRunning(false);
      setActiveStage(null);
      es.close();
    };
  }

  async function toggleKill() {
    if (!state) return;
    setState(await socControl({ action: "kill_switch", engaged: !state.killSwitch }));
  }

  async function setCap(level: AutonomyLevel) {
    setState(await socControl({ action: "autonomy_cap", level }));
  }

  const stageStatus = useMemo(() => {
    const done = new Set(steps.filter((s) => s.status === "done").map((s) => s.stage));
    return { done, active: activeStage };
  }, [steps, activeStage]);

  const target = TARGETS.find((t) => t.id === targetId)!;

  return (
    <div className="space-y-4">
      {state?.killSwitch && (
        <div className="flex items-start gap-3 rounded-lg border border-critical/60 bg-critical/10 p-3 text-sm text-critical">
          <Ban className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-bold uppercase tracking-wider">Kill switch engaged — fallback protocol active</p>
            <p className="text-xs text-critical/85">
              Every incident is pinned to L0. Agents may observe and recommend; no containment action will be
              executed. Every suppressed action is written to the audit trail.
            </p>
          </div>
        </div>
      )}

      {/* Control bar */}
      <section className="panel p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[260px] flex-1">
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
              Live target
            </label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={running}
              className="w-full rounded-md border border-input bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            >
              {TARGETS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">{target.url} · passive GET probes only</p>
          </div>

          <button
            onClick={startRun}
            disabled={running}
            className="scanline relative inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {running ? <Radar className="size-4 animate-spin" /> : <Play className="size-4" />}
            {running ? "Sweep in progress…" : "Run live sweep"}
          </button>

          <button
            onClick={toggleKill}
            className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-bold transition-colors ${
              state?.killSwitch
                ? "border-critical bg-critical text-critical-foreground"
                : "border-critical/60 text-critical hover:bg-critical/10"
            }`}
          >
            <ShieldAlert className="size-4" />
            {state?.killSwitch ? "Release kill switch" : "Kill switch"}
          </button>

          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Gauge className="size-3.5" /> Max autonomy
            </label>
            <div className="flex gap-1">
              {([0, 1, 2, 3, 4] as AutonomyLevel[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setCap(l)}
                  title={AUTONOMY_LABELS[l]}
                  className={`h-9 w-9 rounded-md border text-xs font-bold transition-colors ${
                    state?.autonomyCap === l
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-primary/60 hover:text-foreground"
                  }`}
                >
                  L{l}
                </button>
              ))}
            </div>
          </div>
        </div>
        {state && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Cap: {AUTONOMY_LABELS[state.autonomyCap]} · queue depth {state.queue.length} · trust score{" "}
            {pct(state.trust.trustScore)} · calibration accuracy {pct(state.trust.calibrationAccuracy)}
          </p>
        )}
      </section>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-high/50 bg-high/10 p-3 text-sm text-high">
          <AlertTriangle className="size-4" /> {error}
        </div>
      )}

      {/* Pipeline graph */}
      <section className="panel p-4">
        <h2 className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">Agent team</h2>
        <div className="flex flex-wrap items-center gap-2">
          {STAGES.map((s, i) => {
            const isDone = stageStatus.done.has(s.id);
            const isActive = stageStatus.active === s.id;
            return (
              <div key={s.id} className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors ${
                    isActive
                      ? "border-primary bg-primary/15 text-primary"
                      : isDone
                        ? "border-ok/40 bg-ok/10 text-ok"
                        : "border-border text-muted-foreground"
                  } ${s.id === "orchestrator" ? "font-bold" : ""}`}
                >
                  {isDone ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : (
                    <CircleDot className={`size-3.5 ${isActive ? "animate-livedot" : ""}`} />
                  )}
                  {s.label}
                </div>
                {i < STAGES.length - 1 && <span className="text-grid">→</span>}
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Stream log */}
        <section className="panel flex flex-col p-4">
          <h2 className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">Agent narration stream</h2>
          <div ref={logRef} className="max-h-[420px] min-h-[220px] space-y-2 overflow-y-auto pr-1 text-xs">
            {steps.length === 0 && (
              <p className="text-muted-foreground">
                Idle. Run a sweep to dispatch the orchestrator and its sub-agents against the live target.
              </p>
            )}
            {steps.map((s, i) => (
              <div key={i} className="rounded-md border border-border/70 bg-surface-2/60 p-2">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded bg-agent/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-agent">
                    {s.agent}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{s.status}</span>
                </div>
                <p className="leading-relaxed text-foreground/90">{s.narration}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Probe telemetry */}
        <section className="panel p-4">
          <h2 className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">Live probe telemetry</h2>
          {!snapshot && <p className="text-xs text-muted-foreground">No probe data yet.</p>}
          {snapshot && (
            <>
              <p className="mb-2 text-[11px] text-muted-foreground">
                {snapshot.target} · probed {time(snapshot.probedAt)}
                {snapshot.stale && " · STALE SNAPSHOT"}
              </p>
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="pb-1 text-left">Path</th>
                    <th className="pb-1 text-right">Status</th>
                    <th className="pb-1 text-right">ms</th>
                    <th className="pb-1 text-right">Body</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.probes.map((p) => (
                    <tr key={p.path} className="border-t border-border/60">
                      <td className="py-1 pr-2 font-medium text-foreground/90">{p.path}</td>
                      <td
                        className={`py-1 text-right ${
                          p.status === null
                            ? "text-critical"
                            : p.status < 300
                              ? "text-ok"
                              : p.status < 500
                                ? "text-medium"
                                : "text-high"
                        }`}
                      >
                        {p.status ?? "ERR"}
                      </td>
                      <td className="py-1 text-right text-muted-foreground">{p.ms}</td>
                      <td className="py-1 text-right text-muted-foreground">{p.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>

      {/* Incidents */}
      <section className="space-y-3">
        {incidents.map(({ incident, scored }) => (
          <IncidentCard
            key={incident.id}
            incident={incident}
            scored={scored}
            resolved={resolved[incident.title]}
          />
        ))}
      </section>
    </div>
  );
}

type Scored = {
  supporting: Incident["signals"];
  conflicting: Incident["signals"];
  confidence: number;
  lean: number;
  threatScore: number;
};

function IncidentCard({
  incident,
  scored,
  resolved,
}: {
  incident: Incident;
  scored: Scored;
  resolved?: ResolvedRecord;
}) {
  const decision = resolved?.outcome.decision;
  return (
    <article className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${severityClass[incident.severity]}`}
            >
              {incident.severity}
            </span>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {incident.label}
            </span>
            <h3 className="text-sm font-bold text-foreground">{incident.title}</h3>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {incident.owasp} · {incident.cwe} · {incident.source}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</p>
          <p
            className={`text-2xl font-bold ${scored.confidence >= CONFIDENCE_THRESHOLD ? "text-ok" : "text-medium"}`}
          >
            {pct(scored.confidence)}
          </p>
          <p className="text-[10px] text-muted-foreground">gate ≥ {pct(CONFIDENCE_THRESHOLD)}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Agreeing evidence ({scored.supporting.length})
          </p>
          <div className="space-y-1">
            {scored.supporting.map((s) => (
              <EvidenceBar key={s.name} name={s.name} detail={s.detail} weight={s.weight} tone="critical" />
            ))}
            {scored.supporting.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Conflicting evidence ({scored.conflicting.length})
          </p>
          <div className="space-y-1">
            {scored.conflicting.map((s) => (
              <EvidenceBar key={s.name} name={s.name} detail={s.detail} weight={s.weight} tone="ok" />
            ))}
            {scored.conflicting.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-border/70 bg-surface-2/60 p-3 text-xs">
        <p className="text-foreground/90">
          <span className="font-bold text-agent">Proposed action:</span> {incident.proposedAction}
        </p>
        {resolved && (
          <>
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  decision === "auto_execute"
                    ? "border-ok/50 bg-ok/10 text-ok"
                    : decision === "blocked"
                      ? "border-critical/50 bg-critical/10 text-critical"
                      : "border-medium/50 bg-medium/10 text-medium"
                }`}
              >
                {decision === "auto_execute" ? (
                  <CheckCircle2 className="size-3" />
                ) : decision === "blocked" ? (
                  <Ban className="size-3" />
                ) : (
                  <UserCheck className="size-3" />
                )}
                {decision?.replace("_", " ")}
              </span>
              <span className="rounded border border-agent/40 bg-agent/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-agent">
                {AUTONOMY_LABELS[resolved.outcome.autonomy]}
              </span>
            </p>
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
              {resolved.autonomyRationale.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <p className="mt-2 leading-relaxed text-foreground/90">
              <span className="font-bold text-agent">Analyst report{resolved.aiGenerated ? " (AI)" : ""}:</span>{" "}
              {resolved.report}
            </p>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              <span className="font-bold">Hunt pivot:</span> {resolved.hypothesis}
            </p>
          </>
        )}
      </div>
    </article>
  );
}

function EvidenceBar({
  name,
  detail,
  weight,
  tone,
}: {
  name: string;
  detail: string;
  weight: number;
  tone: "critical" | "ok";
}) {
  return (
    <div className="rounded border border-border/60 bg-surface-2/50 p-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-foreground/90">{name}</span>
        <span className="text-muted-foreground">w {weight.toFixed(2)}</span>
      </div>
      <div className="my-1 h-1 w-full overflow-hidden rounded bg-secondary">
        <div
          className={tone === "critical" ? "h-full bg-critical" : "h-full bg-ok"}
          style={{ width: `${Math.min(100, weight * 160)}%` }}
        />
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">{detail}</p>
    </div>
  );
}
