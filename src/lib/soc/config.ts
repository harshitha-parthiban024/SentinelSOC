import "dotenv/config";

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num(process.env.PORT, 3000),
  ai: {
    provider: (process.env.AI_PROVIDER ?? "none") as "none" | "anthropic" | "openai",
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
    anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
    openaiKey: process.env.OPENAI_API_KEY ?? "",
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  },
  defaultTargetId: process.env.DEFAULT_TARGET_ID ?? "juice-shop",
};
