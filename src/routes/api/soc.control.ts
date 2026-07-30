import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  audit,
  clearQueueAndOutcomes,
  popQueueItem,
  pushOutcome,
  snapshotState,
  updateConfig,
} from "@/lib/soc/state.server";
import type { Outcome } from "@/lib/soc/types";
import { AUTONOMY_LABELS } from "@/lib/soc/types";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("kill_switch"), engaged: z.boolean() }),
  z.object({ action: z.literal("autonomy_cap"), level: z.number().int().min(0).max(4) }),
  z.object({
    action: z.literal("review"),
    incidentId: z.string().min(1).max(80),
    decision: z.enum(["approve", "reject", "escalate"]),
    analyst: z.string().min(1).max(40).default("analyst_01"),
  }),
  z.object({ action: z.literal("reset") }),
]);

export const Route = createFileRoute("/api/soc/control")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch {
          return Response.json({ error: "Invalid request body" }, { status: 400 });
        }

        try {
          if (parsed.action === "kill_switch") {
            await updateConfig({ killSwitch: parsed.engaged });
            await audit(
              "analyst",
              "analyst_01",
              parsed.engaged ? "kill_switch_engaged" : "kill_switch_released",
              parsed.engaged
                ? "Kill switch engaged. All incidents pinned to L0; fallback protocol active — agents may observe and recommend only."
                : "Kill switch released. Tiered autonomy restored under the current analyst cap.",
              "GOVERN",
            );
          }

          if (parsed.action === "autonomy_cap") {
            const level = parsed.level as 0 | 1 | 2 | 3 | 4;
            await updateConfig({ autonomyCap: level });
            await audit(
              "analyst",
              "analyst_01",
              "autonomy_cap_changed",
              `Global autonomy cap set to ${AUTONOMY_LABELS[level]}.`,
              "GOVERN",
            );
          }

          if (parsed.action === "review") {
            const item = await popQueueItem(parsed.incidentId);
            if (!item) return Response.json({ error: "No pending review for that incident" }, { status: 404 });

            const outcome: Outcome = {
              incidentId: item.incidentId,
              title: item.title,
              proposedAction: item.proposedAction,
              confidence: item.confidence,
              autonomy: item.autonomy,
              decision: item.decision,
              resolution: `human_${parsed.decision}`,
              analyst: parsed.analyst,
              timestamp: Date.now(),
            };
            await pushOutcome(outcome);
            await audit(
              "analyst",
              parsed.analyst,
              `human_${parsed.decision}`,
              `${parsed.incidentId}: analyst ${parsed.decision}d "${item.proposedAction}" (agent confidence ${(item.confidence * 100).toFixed(0)}%, autonomy L${item.autonomy}).`,
              "MANAGE",
            );
          }

          if (parsed.action === "reset") {
            await clearQueueAndOutcomes();
            await audit("analyst", "analyst_01", "state_reset", "Review queue and outcome log cleared.", "GOVERN");
          }

          return Response.json(await snapshotState());
        } catch (err) {
          console.error("POST /api/soc/control failed", err);
          return Response.json({ error: "Control action failed" }, { status: 500 });
        }
      },
    },
  },
});
