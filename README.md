# SentinelSOC

An agentic security-incident-response demo: an "orchestrator" runs a
passive recon → triage → correlation → threat-hunt → response →
calibration-gate pipeline against a target site, streams progress live
over SSE, and routes low-confidence findings to a human review queue.

This is a **single, unified full-stack app** — frontend, backend API, and
database all run from one process:

- **Frontend + Backend:** [TanStack Start](https://tanstack.com/start) (React 19 +
  TypeScript). The UI and the API routes (`src/routes/api/soc.*.ts`) live in the
  same app and are built/served together — no separate backend server or CORS
  setup needed.
- **Database:** MongoDB (via Mongoose). All state — kill switch, autonomy cap,
  review queue, outcomes, audit log, recon cache — is persisted, so it survives
  restarts.

The standalone Express backend from the old handover doc is **not used** —
its logic (identical business rules, just Mongo-backed) has been merged
directly into this app's server routes, so you only have one codebase and one
process to run instead of two duplicate implementations glued together over
HTTP.

## 1. Prerequisites

- Node.js 20+ (or Bun, if you prefer — a `bun.lock` is included)
- A MongoDB instance — either:
  - **Local, via Docker** (easiest): `docker compose up -d mongo`
  - **Local, native install** of `mongod`
  - **MongoDB Atlas** (free tier is fine) — grab the connection string

## 2. Setup

```sh
cp .env.example .env
# edit .env if you're using Atlas or a non-default Mongo URI

npm install        # or: bun install
```

The app runs fully functional with **no AI API key** — incident narratives
fall back to a deterministic template. To use real AI-generated narratives,
set `AI_PROVIDER=anthropic` or `AI_PROVIDER=openai` in `.env` plus the
matching API key.

## 3. Run it

**Development:**

```sh
npm run dev         # or: bun run dev
```

Open http://localhost:3000.

**Production:**

```sh
npm run build        # or: bun run build
npm run start         # runs the built server: node .output/server/index.mjs
```

(`start` script added below runs the Node server directly — see
`package.json`.)

## 4. What it does

- Visit `/` and click **Run sweep** to kick off a pipeline run against one of
  the built-in public demo targets (OWASP Juice Shop / PortSwigger Gin & Juice
  Shop). Passive `GET` probes only — no exploitation, no auth attempts.
- Findings above the confidence threshold at a permitted autonomy level are
  auto-resolved; everything else lands in `/queue` for a human decision
  (approve / reject / escalate).
- `/audit` shows the full NIST-AI-RMF-tagged audit trail (GOVERN / MAP /
  MEASURE / MANAGE) of every agent and analyst action.
- The kill switch and global autonomy cap are controllable from the UI and
  immediately affect subsequent runs.

## 5. Project structure

```
SentinelSOC/
├── src/
│   ├── routes/                # pages (file-based routing) + API routes
│   │   ├── index.tsx           /
│   │   ├── queue.tsx            /queue
│   │   ├── audit.tsx            /audit
│   │   └── api/
│   │       ├── soc.state.ts     GET  /api/soc/state
│   │       ├── soc.control.ts   POST /api/soc/control  (kill switch, autonomy cap, review, reset)
│   │       └── soc.run.ts       GET  /api/soc/run       (SSE pipeline stream)
│   ├── lib/soc/
│   │   ├── types.ts             shared types
│   │   ├── config.ts            env-driven runtime config (AI provider, port)
│   │   ├── mongo.server.ts      Mongoose connection (memoized)
│   │   ├── models/              Mongoose schemas (SocConfig, QueueItem, Outcome, AuditEntry, ReconCache)
│   │   ├── state.server.ts      persistence layer — reads/writes MongoDB
│   │   ├── recon.server.ts      passive recon probes + cached snapshots
│   │   ├── engine.server.ts     scoring, autonomy, gating logic (pure functions)
│   │   ├── narrate.server.ts    AI narrative generation (Anthropic/OpenAI, with fallback)
│   │   └── client.ts            fetch helpers used by the React UI
│   └── components/soc/          UI
├── docker-compose.yml            local MongoDB for development
├── .env.example
└── package.json
```

## 6. Deploying (e.g. to a VM/EC2)

The production build targets a plain Node.js server (`nitro` preset
`node-server` — set in `vite.config.ts` — since the MongoDB driver needs a
real TCP-capable Node runtime, not an edge/Workers runtime):

```sh
npm run build
node .output/server/index.mjs
```

Put that behind Nginx and run it under PM2 or systemd, same as any Node app.
Point `MONGODB_URI` at your MongoDB Atlas cluster (or a Mongo instance on the
same box/VPC) via environment variables — never commit real credentials to
`.env`.
