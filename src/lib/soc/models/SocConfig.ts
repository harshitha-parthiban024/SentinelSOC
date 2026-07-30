import { Schema, model } from "mongoose";
import type { AutonomyLevel } from "../types";

export type SocConfigDoc = {
  _id: string; // fixed singleton id: "singleton"
  killSwitch: boolean;
  autonomyCap: AutonomyLevel;
  target: string;
  lastProbeAt: number | null;
};

const schema = new Schema<SocConfigDoc>(
  {
    _id: { type: String, default: "singleton" },
    killSwitch: { type: Boolean, default: false },
    autonomyCap: { type: Number, default: 4 },
    target: { type: String, default: "https://demo.owasp-juice.shop" },
    lastProbeAt: { type: Number, default: null },
  },
  { versionKey: false },
);

export const SocConfigModel = model<SocConfigDoc>("SocConfig", schema, "soc_config");

export async function getOrCreateConfig(): Promise<SocConfigDoc> {
  const existing = await SocConfigModel.findById("singleton").lean();
  if (existing) return existing;
  const created = await SocConfigModel.create({ _id: "singleton" });
  return created.toObject();
}
