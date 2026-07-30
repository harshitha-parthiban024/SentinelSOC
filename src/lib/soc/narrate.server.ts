import { config } from "./config";
import { summariseSignals } from "./engine.server";
import type { AutonomyLevel, GateDecision, Incident } from "./types";

export type AnalystNarrative = {
  hypothesis: string;
  report: string;
  generated: boolean;
};

function fallback(incident: Incident, confidence: number, decision: GateDecision): AnalystNarrative {
  return {
    generated: false,
    hypothesis: `Threat-hunt pivot: look for other ${incident.category.toLowerCase()} weaknesses on the same origin that share the ${incident.owasp} root cause.`,
    report:
      `${incident.title} on ${incident.source}. Mapped to ${incident.owasp} (${incident.cwe}). ` +
      `Evidence lean produced ${(confidence * 100).toFixed(0)}% confidence; calibration gate returned ${decision.replace("_", " ")}. ` +
      `Recommended containment: ${incident.proposedAction}.`,
  };
}

function buildPrompt(input: {
  incident: Incident;
  confidence: number;
  autonomy: AutonomyLevel;
  decision: GateDecision;
  target: string;
}): string {
  return [
    `You are the reporting agent inside an agentic SOC. A passive reconnaissance sweep of the deliberately vulnerable test target ${input.target} produced this finding.`,
    ``,
    `Finding: ${input.incident.title}`,
    `Source: ${input.incident.source}`,
    `Category: ${input.incident.category} | ${input.incident.owasp} | ${input.incident.cwe}`,
    `Severity: ${input.incident.severity}`,
    `Proposed containment: ${input.incident.proposedAction}`,
    `Deterministic confidence: ${(input.confidence * 100).toFixed(0)}%`,
    `Autonomy level granted: L${input.autonomy}`,
    `Calibration gate decision: ${input.decision}`,
    ``,
    `Evidence signals:`,
    summariseSignals(input.incident.signals),
    ``,
    `Return ONLY a JSON object with exactly two string fields, no markdown fences, no preamble:`,
    `{"hypothesis": "...", "report": "..."}`,
    `"hypothesis": one sentence, max 220 characters, a threat-hunting pivot an analyst should check next on this target.`,
    `"report": a defensive incident report for a human analyst, max 700 characters, plain prose, no markdown headings. State what was observed, why the confidence landed where it did (mention agreeing vs conflicting evidence), and what the analyst should do. Never suggest offensive exploitation.`,
  ].join("\n");
}

function parseJsonNarrative(raw: string): { hypothesis: string; report: string } | null {
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  try {
    const obj = JSON.parse(cleaned);
    if (typeof obj.hypothesis === "string" && typeof obj.report === "string") {
      return { hypothesis: obj.hypothesis, report: obj.report };
    }
    return null;
  } catch {
    return null;
  }
}

async function callAnthropic(prompt: string): Promise<string | null> {
  if (!config.ai.anthropicKey) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.ai.anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.ai.anthropicModel,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    console.error("Anthropic narrative call failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return data.content?.find((c) => c.type === "text")?.text ?? null;
}

async function callOpenAI(prompt: string): Promise<string | null> {
  if (!config.ai.openaiKey) return null;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.ai.openaiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.openaiModel,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
    }),
  });
  if (!res.ok) {
    console.error("OpenAI narrative call failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? null;
}

export async function generateNarrative(input: {
  incident: Incident;
  confidence: number;
  autonomy: AutonomyLevel;
  decision: GateDecision;
  target: string;
}): Promise<AnalystNarrative> {
  if (config.ai.provider === "none") {
    return fallback(input.incident, input.confidence, input.decision);
  }

  const prompt = buildPrompt(input);
  try {
    const raw = config.ai.provider === "anthropic" ? await callAnthropic(prompt) : await callOpenAI(prompt);
    if (!raw) return fallback(input.incident, input.confidence, input.decision);
    const parsed = parseJsonNarrative(raw);
    if (!parsed) return fallback(input.incident, input.confidence, input.decision);
    return {
      generated: true,
      hypothesis: parsed.hypothesis.slice(0, 400),
      report: parsed.report.slice(0, 1200),
    };
  } catch (error) {
    console.error("SOC narrative generation failed", error);
    return fallback(input.incident, input.confidence, input.decision);
  }
}
