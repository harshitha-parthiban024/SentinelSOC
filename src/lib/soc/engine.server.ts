import type {
  AutonomyLevel,
  GateDecision,
  Incident,
  Severity,
  Signal,
} from "./types";
import { CONFIDENCE_THRESHOLD } from "./types";

const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 0.2,
  medium: 0.45,
  high: 0.75,
  critical: 1,
};

export function scoreIncident(incident: Incident) {
  const signals = incident.signals;
  const malicious = signals.filter((s) => s.stance === "malicious");
  const benign = signals.filter((s) => s.stance === "benign");
  const maliciousWeight = malicious.reduce((a, s) => a + s.weight, 0);
  const benignWeight = benign.reduce((a, s) => a + s.weight, 0);
  const total = maliciousWeight + benignWeight;
  const lean = total ? maliciousWeight / total : 0.5;
  // Confidence measures how lopsided the evidence is, not how bad it is.
  const confidence = Math.abs(lean - 0.5) * 2;
  const threatScore = lean * SEVERITY_WEIGHT[incident.severity];
  return {
    supporting: malicious,
    conflicting: benign,
    maliciousWeight,
    benignWeight,
    lean,
    confidence,
    threatScore,
  };
}

/**
 * Tiered autonomy scale (Levels 0-4), adjusted dynamically from incident
 * severity, analyst workload and model confidence.
 */
export function computeAutonomy(input: {
  confidence: number;
  severity: Severity;
  queueDepth: number;
  cap: AutonomyLevel;
  killSwitch: boolean;
}): { level: AutonomyLevel; rationale: string[] } {
  const rationale: string[] = [];
  if (input.killSwitch) {
    return {
      level: 0,
      rationale: ["Kill switch engaged — all autonomous action suspended, incident pinned at L0."],
    };
  }

  let level = 0;
  if (input.confidence >= 0.9) level = 4;
  else if (input.confidence >= 0.75) level = 3;
  else if (input.confidence >= CONFIDENCE_THRESHOLD) level = 2;
  else if (input.confidence >= 0.4) level = 1;
  rationale.push(`Model confidence ${(input.confidence * 100).toFixed(0)}% sets a baseline of L${level}.`);

  if (input.severity === "critical" && level > 2) {
    level = 2;
    rationale.push("Critical severity caps autonomy at L2 — a human must approve irreversible containment.");
  } else if (input.severity === "high" && level > 3) {
    level = 3;
    rationale.push("High severity caps autonomy at L3 (revertible auto-execution).");
  }

  if (input.queueDepth >= 5 && level < 3 && input.confidence >= CONFIDENCE_THRESHOLD) {
    level += 1;
    rationale.push(`Analyst workload is high (${input.queueDepth} queued) — autonomy raised to L${level} to shed load.`);
  }

  if (level > input.cap) {
    level = input.cap;
    rationale.push(`Global analyst autonomy cap limits this incident to L${input.cap}.`);
  }

  return { level: level as AutonomyLevel, rationale };
}

export function gate(input: {
  confidence: number;
  autonomy: AutonomyLevel;
  killSwitch: boolean;
}): { decision: GateDecision; reason: string } {
  if (input.killSwitch) {
    return {
      decision: "blocked",
      reason: "Kill switch engaged. Fallback protocol active: recommendation recorded, no action taken.",
    };
  }
  if (input.confidence < CONFIDENCE_THRESHOLD) {
    return {
      decision: "human_review",
      reason: `Confidence ${(input.confidence * 100).toFixed(0)}% is below the calibration threshold of ${(CONFIDENCE_THRESHOLD * 100).toFixed(0)}%. Evidence is contested, so the incident is routed to a human analyst.`,
    };
  }
  if (input.autonomy >= 3) {
    return {
      decision: "auto_execute",
      reason: `Confidence clears the calibration threshold and autonomy L${input.autonomy} permits execution with post-hoc human review.`,
    };
  }
  return {
    decision: "human_review",
    reason: `Confidence clears the threshold but autonomy L${input.autonomy} requires explicit human authorisation before acting.`,
  };
}

export function huntPivots(incident: Incident, all: Incident[]) {
  const related = all.filter(
    (i) => i.id !== incident.id && (i.category === incident.category || i.owasp === incident.owasp),
  );
  const chained = all.filter((i) => i.severity === "high" || i.severity === "critical");
  return {
    related: related.map((i) => ({ id: i.id, title: i.title, owasp: i.owasp })),
    attackChain: chained.length >= 2 ? chained.map((i) => i.label) : [],
  };
}

export function summariseSignals(signals: Signal[]) {
  return signals.map((s) => `${s.name} (${s.stance}, w=${s.weight}): ${s.detail}`).join("\n");
}
