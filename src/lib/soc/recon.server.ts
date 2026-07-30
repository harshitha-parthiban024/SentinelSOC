import https from "https";
import { connectMongo } from "./mongo.server";
import { ReconCacheModel } from "./models/ReconCache";
import type { Incident, ReconSnapshot, Severity, Signal } from "./types";

export const TARGETS = [
  {
    id: "juice-shop",
    label: "OWASP Juice Shop (public demo)",
    url: "https://demo.owasp-juice.shop",
  },
  {
    id: "ginandjuice",
    label: "PortSwigger Gin & Juice Shop (public lab)",
    url: "https://ginandjuice.shop",
  },
] as const;

const PROBE_PATHS = [
  "/",
  "/robots.txt",
  "/ftp",
  "/rest/admin/application-configuration",
  "/this-path-should-not-exist-soc-probe",
];

const UA = "SentinelSOC-ReconAgent/1.0 (passive header + metadata probe only)";

type Probe = {
  path: string;
  status: number | null;
  ms: number;
  headers: Record<string, string>;
  body: string;
  error?: string;
};

// Persisted in MongoDB (recon_cache collection) rather than an in-memory
// variable, so the last-known-good snapshot survives server restarts.

async function probe(base: string, path: string): Promise<Probe> {
  const started = Date.now();
  try {
   const { Agent } = await import("undici");

const res = await fetch(base + path, {
  method: "GET",
  redirect: "follow",
  headers: { "user-agent": UA, accept: "*/*" },
  signal: AbortSignal.timeout(20_000),
  dispatcher: new Agent({
    connect: {
      family: 4,
    },
  }),
});    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const raw = await res.text();
    return {
      path,
      status: res.status,
      ms: Date.now() - started,
      headers,
      body: raw.slice(0, 20_000),
    };
  } catch (err) {
    return {
      path,
      status: null,
      ms: Date.now() - started,
      headers: {},
      body: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function sev(score: number): Severity {
  if (score >= 0.85) return "critical";
  if (score >= 0.6) return "high";
  if (score >= 0.35) return "medium";
  return "low";
}

function incident(
  seed: {
    id: string;
    title: string;
    label: string;
    category: string;
    owasp: string;
    cwe: string;
    proposedAction: string;
    source: string;
  },
  signals: Signal[],
): Incident {
  const mal = signals.filter((s) => s.stance === "malicious").reduce((a, s) => a + s.weight, 0);
  const total = signals.reduce((a, s) => a + s.weight, 0) || 1;
  return {
    ...seed,
    severity: sev(mal / total),
    signals,
    observedAt: Date.now(),
  };
}

export async function runRecon(base: string): Promise<ReconSnapshot> {
  await connectMongo();
  const results = await Promise.all(PROBE_PATHS.map((p) => probe(base, p)));
  const byPath = new Map(results.map((r) => [r.path, r]));
  const root = byPath.get("/")!;

  if (root.status === null) {
    const lastGood = await ReconCacheModel.findById(base).lean();
    if (lastGood) {
      return {
        ...(lastGood as unknown as ReconSnapshot),
        stale: true,
        reachable: false,
        error: `Target unreachable (${root.error ?? "network error"}). Showing last successful snapshot from ${new Date(lastGood.probedAt).toLocaleTimeString()}.`,
      };
    }
    return {
      target: base,
      reachable: false,
      error: `Target unreachable: ${root.error ?? "network error"}`,
      probedAt: Date.now(),
      probes: results.map((r) => ({
        path: r.path,
        status: r.status,
        ms: r.ms,
        note: r.error ?? "",
      })),
      incidents: [],
    };
  }

  const h = root.headers;
  const incidents: Incident[] = [];
  const setCookie = h["set-cookie"] ?? "";

  // 1. Content-Security-Policy
  {
    const csp = h["content-security-policy"];
    const signals: Signal[] = csp
      ? [
          {
            name: "csp_present",
            stance: "benign",
            weight: 0.5,
            detail: `Content-Security-Policy header returned (${csp.slice(0, 90)}…).`,
          },
          {
            name: "csp_unsafe_directives",
            stance: /unsafe-inline|unsafe-eval|\*/.test(csp) ? "malicious" : "benign",
            weight: 0.3,
            detail: /unsafe-inline|unsafe-eval|\*/.test(csp)
              ? "Policy contains wildcard or unsafe-inline/unsafe-eval, weakening XSS containment."
              : "Policy contains no wildcard or unsafe-* directives.",
          },
        ]
      : [
          {
            name: "csp_absent",
            stance: "malicious",
            weight: 0.45,
            detail: "No Content-Security-Policy header on the root document response.",
          },
          {
            name: "html_document",
            stance: "malicious",
            weight: 0.2,
            detail: "Response is a rendered HTML document, so script injection is directly exploitable.",
          },
          {
            name: "frame_protection",
            stance: h["x-frame-options"] ? "benign" : "malicious",
            weight: 0.15,
            detail: h["x-frame-options"]
              ? `X-Frame-Options: ${h["x-frame-options"]} still limits framing-based abuse.`
              : "No framing protection either, so no compensating control exists.",
          },
        ];
    incidents.push(
      incident(
        {
          id: "csp",
          title: csp ? "Weak content security policy on root document" : "Missing content security policy",
          label: "CSP",
          category: "Security misconfiguration",
          owasp: "A05:2021 Security Misconfiguration",
          cwe: "CWE-1021 / CWE-79",
          proposedAction: "Deploy a strict CSP (default-src 'self'; no unsafe-inline) at the edge",
          source: `${base}/`,
        },
        signals,
      ),
    );
  }

  // 2. Transport security
  {
    const hsts = h["strict-transport-security"];
    const https = base.startsWith("https://");
    incidents.push(
      incident(
        {
          id: "transport",
          title: hsts ? "Transport security policy present but incomplete" : "No HTTP Strict Transport Security",
          label: "HSTS",
          category: "Transport security",
          owasp: "A02:2021 Cryptographic Failures",
          cwe: "CWE-319",
          proposedAction: "Enable HSTS with max-age >= 31536000 and includeSubDomains",
          source: `${base}/`,
        },
        [
          {
            name: hsts ? "hsts_present" : "hsts_absent",
            stance: hsts ? "benign" : "malicious",
            weight: 0.45,
            detail: hsts
              ? `Strict-Transport-Security: ${hsts}`
              : "No Strict-Transport-Security header; downgrade and SSL-strip attacks are not prevented.",
          },
          {
            name: https ? "tls_served" : "cleartext_served",
            stance: https ? "benign" : "malicious",
            weight: 0.35,
            detail: https
              ? "Target is served over TLS, limiting practical exposure."
              : "Target answered over cleartext HTTP.",
          },
          {
            name: "hsts_max_age",
            stance: hsts && /max-age=(\d+)/.test(hsts) && Number(RegExp.$1) >= 31536000 ? "benign" : "malicious",
            weight: 0.2,
            detail:
              hsts && /max-age=(\d+)/.test(hsts)
                ? `Declared max-age is ${RegExp.$1}s.`
                : "No sufficient max-age declared.",
          },
        ],
      ),
    );
  }

  // 3. Cookie hygiene
  if (setCookie) {
    const secure = /secure/i.test(setCookie);
    const httpOnly = /httponly/i.test(setCookie);
    const sameSite = /samesite=(lax|strict)/i.test(setCookie);
    incidents.push(
      incident(
        {
          id: "cookies",
          title: "Session cookie attribute review",
          label: "COOKIE",
          category: "Session management",
          owasp: "A07:2021 Identification and Authentication Failures",
          cwe: "CWE-1004 / CWE-614",
          proposedAction: "Re-issue session cookies with Secure, HttpOnly and SameSite=Lax",
          source: `${base}/ (Set-Cookie)`,
        },
        [
          {
            name: "secure_flag",
            stance: secure ? "benign" : "malicious",
            weight: 0.3,
            detail: secure ? "Secure flag set." : "Secure flag missing — cookie may traverse cleartext.",
          },
          {
            name: "httponly_flag",
            stance: httpOnly ? "benign" : "malicious",
            weight: 0.35,
            detail: httpOnly
              ? "HttpOnly flag set, blocking script access."
              : "HttpOnly missing — cookie readable from injected JavaScript.",
          },
          {
            name: "samesite_flag",
            stance: sameSite ? "benign" : "malicious",
            weight: 0.25,
            detail: sameSite
              ? "SameSite restricts cross-site submission."
              : "SameSite not Lax/Strict — cross-site request forgery surface remains.",
          },
        ],
      ),
    );
  }

  // 4. Technology / version disclosure
  {
    const banners = ["server", "x-powered-by", "x-aspnet-version", "x-backend"]
      .map((k) => (h[k] ? `${k}: ${h[k]}` : null))
      .filter(Boolean) as string[];
    incidents.push(
      incident(
        {
          id: "disclosure",
          title: banners.length ? "Server technology fingerprint disclosed" : "Minimal server fingerprint",
          label: "FINGERPRINT",
          category: "Information disclosure",
          owasp: "A05:2021 Security Misconfiguration",
          cwe: "CWE-200",
          proposedAction: "Strip Server/X-Powered-By banners at the reverse proxy",
          source: `${base}/ (response headers)`,
        },
        [
          {
            name: banners.length ? "banner_disclosed" : "banner_suppressed",
            stance: banners.length ? "malicious" : "benign",
            weight: 0.4,
            detail: banners.length
              ? `Response advertises: ${banners.join("; ")}`
              : "No server or framework banner returned.",
          },
          {
            name: "version_string",
            stance: banners.some((b) => /\d+\.\d+/.test(b)) ? "malicious" : "benign",
            weight: 0.3,
            detail: banners.some((b) => /\d+\.\d+/.test(b))
              ? "Banner includes a version number, enabling targeted CVE lookup."
              : "No version numbers present in the banners.",
          },
          {
            name: "operational_value",
            stance: "benign",
            weight: 0.3,
            detail: "Banner disclosure alone is not exploitable and is commonly accepted operational noise.",
          },
        ],
      ),
    );
  }

  // 5. CORS posture
  {
    const acao = h["access-control-allow-origin"];
    const creds = h["access-control-allow-credentials"];
    incidents.push(
      incident(
        {
          id: "cors",
          title: acao === "*" ? "Wildcard cross-origin resource sharing policy" : "Cross-origin policy review",
          label: "CORS",
          category: "Access control",
          owasp: "A01:2021 Broken Access Control",
          cwe: "CWE-942",
          proposedAction: "Restrict Access-Control-Allow-Origin to an explicit allow-list",
          source: `${base}/`,
        },
        [
          {
            name: acao === "*" ? "wildcard_origin" : "scoped_origin",
            stance: acao === "*" ? "malicious" : "benign",
            weight: 0.4,
            detail: acao ? `Access-Control-Allow-Origin: ${acao}` : "No CORS header returned on the root document.",
          },
          {
            name: "credentialed_cors",
            stance: creds === "true" && acao === "*" ? "malicious" : "benign",
            weight: 0.35,
            detail:
              creds === "true"
                ? "Allow-Credentials is true, so a permissive origin would expose authenticated data."
                : "Credentialed cross-origin reads are not enabled.",
          },
          {
            name: "static_content",
            stance: "benign",
            weight: 0.25,
            detail: "Root document is static content; a permissive policy here has limited data impact.",
          },
        ],
      ),
    );
  }

  // 6. Exposed admin configuration endpoint
  {
    const cfg = byPath.get("/rest/admin/application-configuration");
    if (cfg && cfg.status === 200 && cfg.body.trim().startsWith("{")) {
      incidents.push(
        incident(
          {
            id: "config-leak",
            title: "Unauthenticated administrative configuration endpoint",
            label: "CONFIG",
            category: "Broken access control",
            owasp: "A01:2021 Broken Access Control",
            cwe: "CWE-306",
            proposedAction: "Require authentication on /rest/admin/* and rotate any leaked values",
            source: `${base}/rest/admin/application-configuration`,
          },
          [
            {
              name: "unauthenticated_200",
              stance: "malicious",
              weight: 0.5,
              detail: "Admin configuration returned HTTP 200 with no credentials supplied.",
            },
            {
              name: "config_payload",
              stance: "malicious",
              weight: 0.35,
              detail: `JSON configuration body of ${cfg.body.length} bytes returned to an anonymous client.`,
            },
            {
              name: "sensitive_keys",
              stance: /key|secret|token|password/i.test(cfg.body) ? "malicious" : "benign",
              weight: 0.15,
              detail: /key|secret|token|password/i.test(cfg.body)
                ? "Body contains key/secret/token-like field names."
                : "No credential-like field names detected in the body.",
            },
          ],
        ),
      );
    }
  }

  // 7. Directory / file exposure
  {
    const ftp = byPath.get("/ftp");
    if (ftp && ftp.status === 200) {
      incidents.push(
        incident(
          {
            id: "file-exposure",
            title: "Browsable file directory exposed to anonymous users",
            label: "FILES",
            category: "Information disclosure",
            owasp: "A01:2021 Broken Access Control",
            cwe: "CWE-548",
            proposedAction: "Disable directory indexing and move artefacts out of the web root",
            source: `${base}/ftp`,
          },
          [
            {
              name: "directory_listing",
              stance: "malicious",
              weight: 0.5,
              detail: "/ftp returned HTTP 200 with a browsable listing.",
            },
            {
              name: "downloadable_artifacts",
              stance: /\.(pdf|md|bak|zip|json|txt)/i.test(ftp.body) ? "malicious" : "benign",
              weight: 0.3,
              detail: /\.(pdf|md|bak|zip|json|txt)/i.test(ftp.body)
                ? "Listing references downloadable document/backup artefacts."
                : "No obviously sensitive file extensions in the listing.",
            },
            {
              name: "intended_content",
              stance: "benign",
              weight: 0.2,
              detail: "Some listings only contain intentionally public assets.",
            },
          ],
        ),
      );
    }
  }

  // 8. Error handling verbosity
  {
    const err = byPath.get("/this-path-should-not-exist-soc-probe");
    if (err && err.status !== null) {
      const verbose = /stack|trace|at .*\(.*:\d+:\d+\)|Exception|SQLSTATE|Traceback/i.test(err.body);
      incidents.push(
        incident(
          {
            id: "error-handling",
            title: verbose ? "Verbose error output on unknown route" : "Error handling on unknown route",
            label: "ERRORS",
            category: "Information disclosure",
            owasp: "A05:2021 Security Misconfiguration",
            cwe: "CWE-209",
            proposedAction: "Return generic error pages and log stack traces server-side only",
            source: `${base}/this-path-should-not-exist-soc-probe`,
          },
          [
            {
              name: verbose ? "stack_trace_leak" : "generic_error",
              stance: verbose ? "malicious" : "benign",
              weight: 0.45,
              detail: verbose
                ? "Response body contains stack-trace or exception markers."
                : `Unknown route answered ${err.status} without internal detail.`,
            },
            {
              name: "status_code",
              stance: err.status === 404 || err.status === 403 ? "benign" : "malicious",
              weight: 0.3,
              detail: `Unknown route answered HTTP ${err.status}.`,
            },
            {
              name: "body_size",
              stance: err.body.length > 40_000 ? "malicious" : "benign",
              weight: 0.25,
              detail: `Error body was ${err.body.length} bytes.`,
            },
          ],
        ),
      );
    }
  }

  // 9. robots.txt disclosure
  {
    const robots = byPath.get("/robots.txt");
    if (robots && robots.status === 200 && robots.body.length < 5000) {
      const juicy = /admin|backup|internal|private|api|config|ftp/i.test(robots.body);
      incidents.push(
        incident(
          {
            id: "robots",
            title: juicy ? "robots.txt advertises restricted paths" : "robots.txt published",
            label: "ROBOTS",
            category: "Information disclosure",
            owasp: "A05:2021 Security Misconfiguration",
            cwe: "CWE-200",
            proposedAction: "Remove sensitive path hints from robots.txt and enforce authorization instead",
            source: `${base}/robots.txt`,
          },
          [
            {
              name: juicy ? "sensitive_paths_listed" : "benign_paths_listed",
              stance: juicy ? "malicious" : "benign",
              weight: 0.4,
              detail: juicy
                ? "Disallow entries reference admin/internal/backup style paths."
                : "Only ordinary crawl directives present.",
            },
            {
              name: "public_by_design",
              stance: "benign",
              weight: 0.35,
              detail: "robots.txt is a public file by design; disclosure alone is expected.",
            },
            {
              name: "path_enumeration",
              stance: juicy ? "malicious" : "benign",
              weight: 0.25,
              detail: juicy
                ? "Listed paths shorten an attacker's enumeration phase."
                : "No enumeration benefit to an attacker.",
            },
          ],
        ),
      );
    }
  }

  const snapshot: ReconSnapshot = {
    target: base,
    reachable: true,
    probedAt: Date.now(),
    probes: results.map((r) => ({
      path: r.path,
      status: r.status,
      ms: r.ms,
      note: r.error ?? `${(r.body.length / 1024).toFixed(1)} KB`,
    })),
    incidents,
  };
  await ReconCacheModel.findOneAndReplace({ _id: base }, { ...snapshot, _id: base }, { upsert: true });
  return snapshot;
}
