import { connectMongo } from "./mongo.server";
import { AuditEntryModel } from "./models/AuditEntry";
import { OutcomeModel } from "./models/Outcome";
import { QueueItemModel } from "./models/QueueItem";
import { getOrCreateConfig, SocConfigModel } from "./models/SocConfig";
import type { AuditEntry, AutonomyLevel, NistFunction, Outcome, QueueItem, SocState, TrustMetrics } from "./types";

let seeded = false;

async function ensureSeeded() {
  await connectMongo();
  if (seeded) return;
  seeded = true;
  const cfg = await getOrCreateConfig();
  const hasBoot = await AuditEntryModel.exists({ action: "system_start" });
  if (!hasBoot) {
    await audit("system", "SentinelSOC", "system_start", "Agentic incident response system initialised.", "GOVERN");
  }
  void cfg;
}

export async function audit(
  actor: AuditEntry["actor"],
  actorName: string,
  action: string,
  detail: string,
  nist: NistFunction,
): Promise<AuditEntry> {
  await connectMongo();
  const entry: AuditEntry = {
    id: `AUD-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    actor,
    actorName,
    action,
    detail,
    nist,
  };
  await AuditEntryModel.create(entry);
  // Keep the audit log bounded, matching the original in-memory cap of 500.
  const count = await AuditEntryModel.countDocuments();
  if (count > 500) {
    const stale = await AuditEntryModel.find()
      .sort({ timestamp: 1 })
      .limit(count - 500)
      .select("_id");
    await AuditEntryModel.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
  }
  return entry;
}

async function trust(): Promise<TrustMetrics> {
  const [totalDecisions, humanApprovals, humanRejections, escalations, autoExecuted] = await Promise.all([
    OutcomeModel.countDocuments(),
    OutcomeModel.countDocuments({ resolution: "human_approve" }),
    OutcomeModel.countDocuments({ resolution: "human_reject" }),
    OutcomeModel.countDocuments({ resolution: "human_escalate" }),
    OutcomeModel.countDocuments({ resolution: "auto_executed" }),
  ]);
  const reviewed = humanApprovals + humanRejections + escalations;
  const trustScore = reviewed ? humanApprovals / reviewed : 0;

  const confident = await OutcomeModel.find({ confidence: { $gte: 0.68 } })
    .select("resolution")
    .lean();
  const correct = confident.filter(
    (o) => o.resolution === "auto_executed" || o.resolution === "human_approve",
  ).length;

  return {
    totalDecisions,
    humanApprovals,
    humanRejections,
    escalations,
    autoExecuted,
    trustScore,
    calibrationAccuracy: confident.length ? correct / confident.length : 0,
  };
}

export async function snapshotState(): Promise<SocState> {
  await ensureSeeded();
  const cfg = await getOrCreateConfig();
  const [queue, outcomes, auditLog, trustMetrics] = await Promise.all([
    QueueItemModel.find().sort({ timestamp: -1 }).lean(),
    OutcomeModel.find().sort({ timestamp: -1 }).limit(60).lean(),
    AuditEntryModel.find().sort({ timestamp: -1 }).limit(120).lean(),
    trust(),
  ]);

  return {
    killSwitch: cfg.killSwitch,
    autonomyCap: cfg.autonomyCap as AutonomyLevel,
    queue: queue as unknown as QueueItem[],
    outcomes: outcomes as unknown as Outcome[],
    audit: auditLog as unknown as AuditEntry[],
    trust: trustMetrics,
    target: cfg.target,
    lastProbeAt: cfg.lastProbeAt,
  };
}

export async function updateConfig(
  patch: Partial<{ killSwitch: boolean; autonomyCap: number; target: string; lastProbeAt: number }>,
): Promise<void> {
  await ensureSeeded();
  await SocConfigModel.updateOne({ _id: "singleton" }, { $set: patch });
}

export async function getConfig() {
  await ensureSeeded();
  return getOrCreateConfig();
}

export async function pushQueueItem(item: QueueItem): Promise<void> {
  await connectMongo();
  await QueueItemModel.create(item);
}

export async function popQueueItem(incidentId: string): Promise<QueueItem | null> {
  await connectMongo();
  const item = await QueueItemModel.findOne({ incidentId }).lean();
  if (!item) return null;
  await QueueItemModel.deleteOne({ incidentId });
  return item as unknown as QueueItem;
}

export async function pushOutcome(outcome: Outcome): Promise<void> {
  await connectMongo();
  await OutcomeModel.create(outcome);
}

export async function clearQueueAndOutcomes(): Promise<void> {
  await connectMongo();
  await Promise.all([QueueItemModel.deleteMany({}), OutcomeModel.deleteMany({})]);
}

export async function getQueueSize(): Promise<number> {
  await connectMongo();
  return QueueItemModel.countDocuments();
}
