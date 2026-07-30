import { Schema, model } from "mongoose";
import type { GateDecision, Outcome } from "../types";

const schema = new Schema<Outcome>(
  {
    incidentId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    proposedAction: { type: String, required: true },
    confidence: { type: Number, required: true },
    autonomy: { type: Number, required: true },
    decision: { type: String, enum: ["auto_execute", "human_review", "blocked"] as GateDecision[], required: true },
    resolution: { type: String, required: true },
    analyst: { type: String },
    timestamp: { type: Number, required: true, index: true },
  },
  { versionKey: false },
);

export const OutcomeModel = model<Outcome>("Outcome", schema, "outcomes");
