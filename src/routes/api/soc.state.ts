import { createFileRoute } from "@tanstack/react-router";
import { snapshotState } from "@/lib/soc/state.server";

export const Route = createFileRoute("/api/soc/state")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const state = await snapshotState();
          return Response.json(state);
        } catch (err) {
          console.error("GET /api/soc/state failed", err);
          return Response.json({ error: "Unable to load SOC state" }, { status: 500 });
        }
      },
    },
  },
});
