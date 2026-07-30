import type { AutonomyLevel, Severity, SocState } from "./types";

export async function fetchSocState(): Promise<SocState> {
  const res = await fetch("/api/soc/state");
  if (!res.ok) throw new Error("Unable to load SOC state");
  return res.json();
}

export async function socControl(
  body:
    | { action: "kill_switch"; engaged: boolean }
    | { action: "autonomy_cap"; level: AutonomyLevel }
    | { action: "review"; incidentId: string; decision: "approve" | "reject" | "escalate"; analyst?: string }
    | { action: "reset" },
): Promise<SocState> {
  const res = await fetch("/api/soc/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Control action failed");
  return res.json();
}

export const severityClass: Record<Severity, string> = {
  critical: "text-critical border-critical/50 bg-critical/10",
  high: "text-high border-high/50 bg-high/10",
  medium: "text-medium border-medium/50 bg-medium/10",
  low: "text-low border-low/50 bg-low/10",
};

export function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export function time(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}
