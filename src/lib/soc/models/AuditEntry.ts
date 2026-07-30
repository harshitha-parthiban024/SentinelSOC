import { Schema, model } from "mongoose";
import type { AuditEntry, NistFunction } from "../types";

const schema = new Schema<AuditEntry>(
  {
    id: { type: String, required: true, unique: true },
    timestamp: { type: Number, required: true, index: true },
    actor: { type: String, enum: ["agent", "analyst", "system"], required: true },
    actorName: { type: String, required: true },
    action: { type: String, required: true },
    detail: { type: String, required: true },
    nist: { type: String, enum: ["GOVERN", "MAP", "MEASURE", "MANAGE"] as NistFunction[], required: true },
  },
  { versionKey: false },
);

export const AuditEntryModel = model<AuditEntry>("AuditEntry", schema, "audit_log");
