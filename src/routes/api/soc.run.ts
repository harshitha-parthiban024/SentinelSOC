import { createFileRoute } from "@tanstack/react-router";
import { computeAutonomy, gate, huntPivots, scoreIncident } from "@/lib/soc/engine.server";
import { generateNarrative } from "@/lib/soc/narrate.server";
import { runRecon, TARGETS } from "@/lib/soc/recon.server";
import {
  audit,
  getConfig,
  getQueueSize,
  pushOutcome,
  pushQueueItem,
  snapshotState,
  updateConfig,
} from "@/lib/soc/state.server";
import type { Outcome, QueueItem, StageResult } from "@/lib/soc/types";
import { AUTONOMY_LABELS, CONFIDENCE_THRESHOLD } from "@/lib/soc/types";

export const Route = createFileRoute("/api/soc/run")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const targetId = url.searchParams.get("target") ?? "juice-shop";
        const target = TARGETS.find((t) => t.id === targetId) ?? TARGETS[0];
        await updateConfig({ target: target.url });

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (data: unknown) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };
            const step = (r: StageResult) => send({ type: "step", ...r });
            const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

            try {
              const cfg = await getConfig();
              const killSwitch = cfg.killSwitch;

              step({
                stage: "orchestrator",
                agent: "Orchestrator",
                status: "running",
                narration: `Planning sweep of ${target.label}. Dispatching recon → triage → correlation → threat-hunt → response → calibration gate.`,
                payload: { target: target.url, killSwitch, autonomyCap: cfg.autonomyCap },
              });
              await audit(
                "agent",
                "Orchestrator",
                "run_started",
                `Passive reconnaissance run dispatched against ${target.url}.`,
                "MAP",
              );
              await pause(250);

              step({
                stage: "recon",
                agent: "Recon agent",
                status: "running",
                narration: `Issuing passive GET probes against ${target.url}. No payloads, no authentication attempts.`,
                payload: {},
              });

              const snapshot = await runRecon(target.url,target.id);
              await updateConfig({ lastProbeAt: snapshot.probedAt });
              send({ type: "recon", snapshot });

              if (!snapshot.reachable && snapshot.incidents.length === 0) {
                step({
                  stage: "recon",
                  agent: "Recon agent",
                  status: "done",
                  narration: snapshot.error ?? "Target unreachable.",
                  payload: { probes: snapshot.probes },
                });
                await audit("agent", "Recon agent", "recon_failed", snapshot.error ?? "Target unreachable.", "MEASURE");
                send({ type: "error", message: snapshot.error ?? "Target unreachable." });
                send({ type: "state", state: await snapshotState() });
                controller.close();
                return;
              }

              step({
                stage: "recon",
                agent: "Recon agent",
                status: "done",
                narration:
                  `${snapshot.probes.length} probes completed in ` +
                  `${Math.max(...snapshot.probes.map((p) => p.ms))}ms worst-case. ` +
                  `${snapshot.incidents.length} candidate findings extracted from live response metadata.` +
                  (snapshot.stale ? " (Serving last known-good snapshot: target is currently unreachable.)" : ""),
                payload: { probes: snapshot.probes, findings: snapshot.incidents.length },
              });
              await pause(250);

              const ranked = [...snapshot.incidents].sort(
                (a, b) => scoreIncident(b).threatScore - scoreIncident(a).threatScore,
              );

              step({
                stage: "orchestrator",
                agent: "Orchestrator",
                status: "done",
                narration: `${ranked.length} findings ranked by threat score. Processing each through the agent team sequentially.`,
                payload: { order: ranked.map((i) => i.label) },
              });
              await pause(200);

              for (const incident of ranked) {
                const scored = scoreIncident(incident);
                send({ type: "incident", incident, scored });

                step({
                  stage: "triage",
                  agent: "Triage agent",
                  status: "done",
                  narration:
                    `[${incident.label}] Classified as ${incident.category} (${incident.owasp}). ` +
                    `${incident.signals.length} evidence signals parsed. Initial severity: ${incident.severity.toUpperCase()}.`,
                  payload: {
                    incidentId: incident.id,
                    severity: incident.severity,
                    cwe: incident.cwe,
                  },
                });
                await pause(180);

                step({
                  stage: "correlation",
                  agent: "Correlation agent",
                  status: "done",
                  narration:
                    `[${incident.label}] ${scored.supporting.length} signal(s) support a genuine weakness, ` +
                    `${scored.conflicting.length} signal(s) argue benign/expected. Evidence lean ${(scored.lean * 100).toFixed(0)}% malicious.`,
                  payload: {
                    incidentId: incident.id,
                    supporting: scored.supporting.length,
                    conflicting: scored.conflicting.length,
                    lean: scored.lean,
                  },
                });
                await pause(180);

                const pivots = huntPivots(incident, ranked);
                step({
                  stage: "hunt",
                  agent: "Threat-hunt agent",
                  status: "done",
                  narration:
                    `[${incident.label}] ${pivots.related.length} related finding(s) share this root cause` +
                    (pivots.attackChain.length
                      ? `; plausible chain across ${pivots.attackChain.join(" → ")}.`
                      : "; no multi-stage chain detected."),
                  payload: { incidentId: incident.id, ...pivots },
                });
                await pause(180);

                const queueDepth = await getQueueSize();
                const autonomy = computeAutonomy({
                  confidence: scored.confidence,
                  severity: incident.severity,
                  queueDepth,
                  cap: cfg.autonomyCap,
                  killSwitch: cfg.killSwitch,
                });

                step({
                  stage: "response",
                  agent: "Response agent",
                  status: "done",
                  narration:
                    `[${incident.label}] Proposed action: "${incident.proposedAction}". ` +
                    `Self-reported confidence ${(scored.confidence * 100).toFixed(0)}%. ` +
                    `Autonomy granted: ${AUTONOMY_LABELS[autonomy.level]}.`,
                  payload: {
                    incidentId: incident.id,
                    proposedAction: incident.proposedAction,
                    confidence: scored.confidence,
                    autonomy: autonomy.level,
                    autonomyRationale: autonomy.rationale,
                  },
                });
                await pause(180);

                const decision = gate({
                  confidence: scored.confidence,
                  autonomy: autonomy.level,
                  killSwitch: cfg.killSwitch,
                });

                const narrative = await generateNarrative({
                  incident,
                  confidence: scored.confidence,
                  autonomy: autonomy.level,
                  decision: decision.decision,
                  target: target.url,
                });

                step({
                  stage: "gate",
                  agent: "Calibration gate",
                  status: "done",
                  narration: `[${incident.label}] ${decision.reason}`,
                  payload: {
                    incidentId: incident.id,
                    decision: decision.decision,
                    threshold: CONFIDENCE_THRESHOLD,
                    confidence: scored.confidence,
                    autonomy: autonomy.level,
                    hypothesis: narrative.hypothesis,
                    report: narrative.report,
                    aiGenerated: narrative.generated,
                  },
                });

                const incidentId = `INC-${incident.id.toUpperCase()}-${Date.now().toString(36).slice(-4)}`;
                const base: Outcome = {
                  incidentId,
                  title: incident.title,
                  proposedAction: incident.proposedAction,
                  confidence: scored.confidence,
                  autonomy: autonomy.level,
                  decision: decision.decision,
                  resolution:
                    decision.decision === "auto_execute"
                      ? "auto_executed"
                      : decision.decision === "blocked"
                        ? "blocked_by_kill_switch"
                        : "pending_human_review",
                  timestamp: Date.now(),
                };

                if (decision.decision === "auto_execute") {
                  await pushOutcome(base);
                  await audit(
                    "agent",
                    "Response agent",
                    "action_auto_executed",
                    `${incidentId}: "${incident.proposedAction}" executed autonomously at L${autonomy.level} (confidence ${(scored.confidence * 100).toFixed(0)}%).`,
                    "MANAGE",
                  );
                } else if (decision.decision === "blocked") {
                  await pushOutcome(base);
                  await audit(
                    "system",
                    "Kill switch",
                    "action_blocked",
                    `${incidentId}: autonomous action suppressed by the kill switch; recommendation logged only.`,
                    "GOVERN",
                  );
                } else {
                  const item: QueueItem = {
                    ...base,
                    incident,
                    supporting: scored.supporting,
                    conflicting: scored.conflicting,
                    report: narrative.report,
                  };
                  await pushQueueItem(item);
                  await audit(
                    "agent",
                    "Calibration gate",
                    "escalated_to_human",
                    `${incidentId}: routed to the human review queue — ${decision.reason}`,
                    "MEASURE",
                  );
                }

                send({
                  type: "resolved",
                  outcome: base,
                  hypothesis: narrative.hypothesis,
                  report: narrative.report,
                  aiGenerated: narrative.generated,
                  autonomyRationale: autonomy.rationale,
                });
                await pause(120);
              }

              await audit(
                "agent",
                "Orchestrator",
                "run_completed",
                `Run finished: ${ranked.length} findings processed against ${target.url}.`,
                "MEASURE",
              );
              send({ type: "state", state: await snapshotState() });
              send({ type: "complete", findings: ranked.length });
            } catch (err) {
              console.error("SOC run failed", err);
              send({ type: "error", message: err instanceof Error ? err.message : "Pipeline failure" });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
          },
        });
      },
    },
  },
});
