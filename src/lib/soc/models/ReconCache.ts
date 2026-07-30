import { Schema, model } from "mongoose";
import type { ReconSnapshot } from "../types";

const probeSchema = new Schema(
  {
    path: { type: String, required: true },
    status: { type: Number, default: null },
    ms: { type: Number, required: true },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const signalSchema = new Schema(
  {
    name: { type: String, required: true },
    stance: { type: String, enum: ["malicious", "benign"], required: true },
    weight: { type: Number, required: true },
    detail: { type: String, required: true },
  },
  { _id: false },
);

const incidentSchema = new Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    label: { type: String, required: true },
    category: { type: String, required: true },
    owasp: { type: String, required: true },
    cwe: { type: String, required: true },
    severity: { type: String, enum: ["low", "medium", "high", "critical"], required: true },
    signals: { type: [signalSchema], default: [] },
    proposedAction: { type: String, required: true },
    source: { type: String, required: true },
    observedAt: { type: Number, required: true },
  },
  { _id: false },
);

const schema = new Schema<ReconSnapshot & { _id: string }>(
  {
    _id: { type: String, required: true }, // target base URL
    target: { type: String, required: true },
    reachable: { type: Boolean, required: true },
    error: { type: String },
    probedAt: { type: Number, required: true },
    probes: { type: [probeSchema], default: [] },
    incidents: { type: [incidentSchema], default: [] },
    stale: { type: Boolean },
  },
  { versionKey: false },
);

export const ReconCacheModel = model<ReconSnapshot & { _id: string }>("ReconCache", schema, "recon_cache");
