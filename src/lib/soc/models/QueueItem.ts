import { Schema, model } from "mongoose";
import type { GateDecision, QueueItem, Signal } from "../types";

const signalSchema = new Schema<Signal>(
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

const schema = new Schema<QueueItem>(
  {
    incidentId: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    proposedAction: { type: String, required: true },
    confidence: { type: Number, required: true },
    autonomy: { type: Number, required: true },
    decision: { type: String, enum: ["auto_execute", "human_review", "blocked"] as GateDecision[], required: true },
    resolution: { type: String, required: true },
    analyst: { type: String },
    timestamp: { type: Number, required: true, index: true },
    incident: { type: incidentSchema, required: true },
    supporting: { type: [signalSchema], default: [] },
    conflicting: { type: [signalSchema], default: [] },
    report: { type: String, default: "" },
  },
  { versionKey: false },
);

export const QueueItemModel = model<QueueItem>("QueueItem", schema, "review_queue");
