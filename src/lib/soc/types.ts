export type Stance = "malicious" | "benign";

export type Signal = {
  name: string;
  stance: Stance;
  weight: number;
  detail: string;
};

export type Severity = "low" | "medium" | "high" | "critical";

export type Incident = {
  id: string;
  title: string;
  label: string;
  category: string;
  owasp: string;
  cwe: string;
  severity: Severity;
  signals: Signal[];
  proposedAction: string;
  source: string;
  observedAt: number;
};

export type ReconSnapshot = {
  target: string;
  reachable: boolean;
  error?: string;
  probedAt: number;
  probes: { path: string; status: number | null; ms: number; note: string }[];
  incidents: Incident[];
  stale?: boolean;
};

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export type GateDecision = "auto_execute" | "human_review" | "blocked";

export type StageId =
  | "orchestrator"
  | "recon"
  | "triage"
  | "correlation"
  | "hunt"
  | "response"
  | "gate";

export type StageResult = {
  stage: StageId;
  agent: string;
  status: "running" | "done";
  narration: string;
  payload: Record<string, unknown>;
};

export type Outcome = {
  incidentId: string;
  title: string;
  proposedAction: string;
  confidence: number;
  autonomy: AutonomyLevel;
  decision: GateDecision;
  resolution: string;
  analyst?: string;
  timestamp: number;
};

export type QueueItem = Outcome & {
  incident: Incident;
  supporting: Signal[];
  conflicting: Signal[];
  report: string;
};

export type NistFunction = "GOVERN" | "MAP" | "MEASURE" | "MANAGE";

export type AuditEntry = {
  id: string;
  timestamp: number;
  actor: "agent" | "analyst" | "system";
  actorName: string;
  action: string;
  detail: string;
  nist: NistFunction;
};

export type TrustMetrics = {
  totalDecisions: number;
  humanApprovals: number;
  humanRejections: number;
  escalations: number;
  autoExecuted: number;
  trustScore: number;
  calibrationAccuracy: number;
};

export type SocState = {
  killSwitch: boolean;
  autonomyCap: AutonomyLevel;
  queue: QueueItem[];
  outcomes: Outcome[];
  audit: AuditEntry[];
  trust: TrustMetrics;
  target: string;
  lastProbeAt: number | null;
};

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  0: "L0 · Observe only",
  1: "L1 · Suggest, analyst decides",
  2: "L2 · Prepared action, one-click approve",
  3: "L3 · Auto-execute, revertible",
  4: "L4 · Fully autonomous",
};

export const CONFIDENCE_THRESHOLD = 0.68;
