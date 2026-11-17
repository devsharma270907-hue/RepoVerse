# RepoVerse — Product Requirements Document

## AI-Powered Codebase Intelligence & Visualization Platform

Version: 1.0 (Draft) Stack baseline: MERN + TypeScript (adapted from internal Full-Stack Project Blueprint v2.2) Owner: Product / Engineering Audience: Founders, engineers, AI coding assistants, designers, early pilot users Status: Pre-build — for review before Section 17 "Master Bootstrap Prompt" is run

⚠️ Version Safety Rule carried over from the blueprint: no dependency version in this PRD is authoritative. Before any package.json is written, web-search each package for latest stable + advisories and confirm with `npm show <pkg> version`. Never copy semver literals from this document.

## Table of Contents

1. Product Overview
2. Problem Statement & Goals
3. Target Users & Personas
4. Core Features
5. Key User Flows
6. Tech Stack
7. Repository Structure
8. Environment Variables
9. Backend Architecture
10. Code Analysis & AI Pipeline
11. API Documentation Standard
12. Backend Security Checklist
13. Frontend Architecture
14. Frontend Security Checklist
15. Success Metrics (KPIs)
16. Roadmap / Phasing
17. Master Bootstrap Prompt
18. Open Questions & Risks

---

## 1. Product Overview

RepoVerse (working name: CodeAtlas) is an AI-powered codebase intelligence platform. A developer pastes a GitHub repository URL; RepoVerse clones/analyzes it and produces a living visual map of the codebase — which files exist, which functions and classes are defined, how modules communicate, which files import/depend on which, and where any function is called from.

RepoVerse is explicitly **not just a dependency visualizer**. On top of the structural graph it layers five intelligence features:

1. **AI Code Explanation** — plain-English explanation of any selected file, class, or function.
2. **Impact Analysis** — "if I change this function, what else might break?" computed from the call/dependency graph.
3. **Circular Dependency Detection** — identifies problematic import/dependency loops and ranks them by blast radius.
4. **Code Health Score** — complexity, coupling, and dead-code metrics rolled into an explainable per-file/per-repo score.
5. **Smart Search** — ask natural-language questions ("Where is user authentication handled?") and jump straight to the answer on the map.

The differentiator is that RepoVerse treats a codebase as a **queryable graph + an AI reasoning layer**, not a static diagram. Every visual element is backed by computed data; every AI answer is grounded in it.

## 2. Problem Statement & Goals

Problem: When a developer downloads or joins a project with 100+ files (open-source contribution, new job, inherited codebase, hackathon handoff), there is no fast way to understand how everything connects. Reading files linearly doesn't reveal the architecture; existing tools either show only raw dependency trees, or are heavyweight IDE plugins that don't explain anything.

Goals (v1):

- Time from "paste repo URL" to "interactive graph on screen" under 90 seconds for repos up to ~500 files.
- Answer "where is X handled?" style questions in one query, with the answer highlighted on the map.
- Detect every circular dependency with a ranked, actionable explanation (not just a red edge).
- Give every analyzed repo a Code Health Score with a breakdown a maintainer can act on.
- Never require repo owners to install anything — analysis is fully server-side and read-only.

Non-goals (v1):

- RepoVerse does not modify code, open PRs, or write to the analyzed repository.
- RepoVerse is not a linter/formatter/CI gate in v1 (health score is informational).
- No GitHub App/marketplace integration in v1 (public repos by URL; private repos come later via PAT).
- RepoVerse does not guarantee AI explanations are "correct" — they are guidance grounded in the graph, with the source always shown.

## 3. Target Users & Personas

| Persona | Description | Primary Jobs-to-be-Done |
| --- | --- | --- |
| New-Joiner Developer (primary) | Developer in week 1–4 at a job or new team, facing an unfamiliar 100+ file codebase | "Show me how this app actually works so I can ship without fear." |
| OSS Contributor | Developer wanting to contribute to an open-source project | "Find the code that handles this bug and what it touches." |
| Tech Lead / Reviewer | Lead assessing a codebase for review, refactoring, or adoption | "What's the coupling? Where are the cycles? What breaks if I refactor this?" |
| Student / Learner | Student studying how real projects are structured | "Explain what this function does and why it exists." |

## 4. Core Features

### 4.1 Repo Ingestion & Structural Map

- Paste a GitHub URL (or search a user/org's public repos via the GitHub API).
- Server-side clone (shallow) or GitHub API tree fetch → file tree with sizes, languages detected (extension + content heuristic), and per-file symbol extraction.
- Language support in v1: TypeScript, JavaScript (incl. JSX/TSX), Python (best-effort), with framework-agnostic fallback (file-level graph only) for everything else.
- Graph stored as first-class data: **nodes** (repo, file, class, function, method) and **edges** (`imports`, `defines`, `calls`, `extends`), so every view is a graph query.

### 4.2 Dependency & Call Graph View

- File-level import graph (the visual map): nodes = files, edges = imports; node size/color by fan-in/fan-out and language.
- Symbol-level drill-down: click a file → its classes and functions; click a function → **all call sites** ("where is this called from?").
- Legend, zoom/pan, isolate-subgraph, and search-highlighting on the map.

### 4.3 Impact Analysis

- Select any function/class/file → compute **transitive dependents** across `calls` + `imports` edges ("affected set").
- Risk rating per affected file: direct vs transitive impact, whether it's on a critical path (high fan-in).
- Reverse mode: "what does this file depend on?" vs "what depends on this file?"

### 4.4 Circular Dependency Detection

- Strongly-connected-component (SCC) detection over the import graph.
- Each cycle listed with the full path (A → B → C → A), cycle length, and a severity score weighted by the fan-in of involved files.
- Suggested resolution hints (which edge is the most likely "break point" based on direction of dependency and layering heuristics).

### 4.5 Code Health Score

- Per-file and repo-level score (0–100) with transparent sub-scores:
  - **Complexity** — function length, nesting depth, parameter count, cyclomatic estimate (static heuristics; no execution).
  - **Coupling** — fan-in/fan-out, instability ratio (Ca/Ce), shared-state hotspots.
  - **Dead code** — exported/defined symbols with zero incoming `calls`/`imports` edges.
- Score is **explainable**: every point deduction maps to a listed finding with a location.

### 4.6 AI Code Explanation

- Select any node (file/class/function) → grounded explanation generated by an LLM from the symbol's source + a compact graph context (who calls it, what it imports).
- Always shows the exact source lines used as context — the answer is never unanchored.
- Caches per (symbol, commit SHA) so re-analyzes are cheap.

### 4.7 Smart Search (Natural-Language Code Q&A)

- Query box: "Where is user authentication handled?" → semantic search over embedded file/function summaries + symbol-name matching → top results as ranked map locations with a one-line "why this matched".
- Uses MongoDB Atlas Vector Search over chunk/file embeddings; symbol-name search (regex/trigram) runs in parallel and results are merged.

### 4.8 Analysis Timeline & Refresh

- Repo analyses are versioned by commit SHA; re-analyzing the same SHA reuses cached graphs (hash-compare, never re-parse unchanged files).
- Diff-aware re-analysis on new SHA: only changed files re-parsed, edges updated incrementally.

### 4.9 Global Command Palette (Cmd+K / Ctrl+K)

- Keyboard-driven navigation: jump to file/function, run Smart Search query, toggle Impact mode, open Health dashboard.

## 5. Key User Flows

- **Onboarding:** Sign up → paste GitHub repo URL → RepoVerse validates & fetches → progress via real-time updates (clone → parse → graph → embeddings) → map renders.
- **Explore loop:** Open map → click file → symbol panel → click function → see all call sites highlighted → flip to Impact mode → see affected files.
- **Health loop:** Open Health dashboard → score breakdown → click a finding → map highlights the offending file/cycle → AI explanation suggests a fix direction.
- **Search loop:** Cmd+K → "Where is auth handled?" → top result highlighted on map → open explanation panel.
- **Re-analyze loop:** Repo has new commits → user clicks refresh → diff-aware incremental analysis → graph updates without full recompute.

## 6. Tech Stack

Same verification discipline as the base blueprint applies: every package below is a name to verify, not a version to copy. Web search + `npm show <pkg> version` + advisory check before any install.

| Layer | Choice | Notes |
| --- | --- | --- |
| Runtime | Node.js | Web-search current Active LTS (verified: 26.x Active LTS as of Nov 2026) |
| Framework | Express | Verify latest stable major |
| Language | TypeScript | Strict mode everywhere |
| Database | MongoDB Atlas | Graph nodes/edges, users, analysis metadata |
| ODM | Mongoose | Match driver/Atlas compatibility |
| Vector store | MongoDB Atlas Vector Search | Smart Search embeddings |
| Validation | Zod | Env + request bodies + LLM output schemas |
| Auth | Google OAuth + Email/Password | Passport.js strategies |
| JWT | jsonwebtoken | Access (15m) + refresh (7d) |
| Password hashing | bcryptjs | Cost ≥ 10 |
| Repo ingestion | @octokit/rest + simple-git | GitHub API tree/metadata; shallow clone fallback for large repos |
| JS/TS parsing | ts-morph (TypeScript compiler API) | Symbols, imports, call expressions |
| Python parsing | LLM-assisted extraction (phase 2) or tree-sitter-python | Best-effort v1 |
| AI/LLM provider | Claude API via @anthropic-ai/sdk | Explanation, Smart Search answer synthesis, LLM output Zod-validated |
| Security headers | helmet | Tune CSP for SPA |
| CORS | cors | Explicit origin allowlist |
| Rate limiting | express-rate-limit | Stricter on /ai/* and /analyze routes (cost + compute control) |
| NoSQL sanitize | express-mongo-sanitize | Injection prevention |
| Real-time | socket.io | Analysis progress streaming (JWT-guarded) |
| Job scheduling | node-cron | Stale-analysis cleanup, orphan temp-dir GC |
| Logging | winston | Never log repo source code or tokens |
| Monitoring | @sentry/node | Error tracking; scrub code content in beforeSend |
| Frontend | React + Vite | SPA |
| Routing | react-router-dom | Protected routes |
| Server state | TanStack Query | Caching + retries |
| HTTP client | Axios | Refresh interceptors |
| Forms | React Hook Form + Zod | Validated forms |
| Graph rendering | `<GRAPH_LIB>` — candidate: React Flow / Sigma.js / Cytoscape.js (spike before Phase 1 freeze) | Map canvas; layout computed client-side |
| HTML sanitize | DOMPurify | AI-generated rich text |
| Deploy: Frontend | Vercel | |
| Deploy: Backend | Render / Railway | Needs disk headroom for shallow clones |
| Deploy: DB | MongoDB Atlas | IP allowlist required |

Token lifetime standard (unchanged from blueprint):

- Access JWT: 15 minutes — `Authorization: Bearer` header
- Refresh token: 7 days — `HttpOnly; Secure; SameSite=Strict` cookie

## 7. Repository Structure

```
RepoVerse/
├── backend/
│   ├── src/
│   │   ├── server.ts                  # Entry: DB connect → cron start → listen
│   │   ├── app.ts                     # Express app: middleware stack + route mounts
│   │   ├── config/
│   │   │   ├── env.ts                 # Zod-validated env — crash on startup if misconfigured
│   │   │   ├── db.ts                  # mongoose.connect + disconnect
│   │   │   └── passport.ts            # Google OAuth strategy (only if env vars present)
│   │   ├── middleware/
│   │   │   ├── requireAuth.ts         # JWT verify → attach req.user
│   │   │   ├── validate.ts            # Zod schema factory → 400 on failure
│   │   │   ├── roleGuard.ts
│   │   │   ├── aiRateLimit.ts         # per-user AI-call budget guard
│   │   │   └── errorHandler.ts        # Central error → standard JSON response
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   │   ├── auth.routes.ts
│   │   │   │   ├── auth.controller.ts
│   │   │   │   ├── auth.service.ts
│   │   │   │   └── auth.schema.ts
│   │   │   ├── users/
│   │   │   │   ├── user.model.ts
│   │   │   │   └── ...                # routes/controller/service/schema
│   │   │   ├── repos/                 # repo registration, ownership, GitHub fetch
│   │   │   ├── analyses/              # graph nodes/edges model + analysis runs
│   │   │   ├── graph/                 # graph query endpoints (tree, imports, callers)
│   │   │   ├── insights/              # impact, cycles, health score endpoints
│   │   │   └── ai/                    # explanation + smart search endpoints
│   │   ├── services/
│   │   │   ├── analyzer/
│   │   │   │   ├── fetcher.ts         # clone/tree fetch + size & SSRF guards
│   │   │   │   ├── parser.ts          # per-language symbol + import extraction
│   │   │   │   ├── graphBuilder.ts    # nodes/edges assembly, SCC, fan-in/out
│   │   │   │   ├── health.ts          # complexity/coupling/dead-code scoring
│   │   │   │   └── queue.ts           # analysis job queue (in-process v1, node-cron worker)
│   │   │   ├── ai/
│   │   │   │   ├── claudeClient.ts    # thin Anthropic SDK wrapper
│   │   │   │   ├── explainer.ts       # grounded code explanation
│   │   │   │   └── smartSearch.ts     # embeddings + rerank
│   │   │   ├── email.service.ts
│   │   │   └── cron.service.ts
│   │   ├── sockets/
│   │   │   └── index.ts               # JWT auth guard + per-analysis progress rooms
│   │   ├── utils/
│   │   │   ├── jwt.ts
│   │   │   ├── encryption.ts          # AES-256-GCM (GitHub PATs, secrets)
│   │   │   ├── ownershipCheck.ts
│   │   │   ├── tokenCompare.ts
│   │   │   └── tempDir.ts             # safe temp workspace create/destroy
│   │   └── types/
│   │       └── express.d.ts
│   ├── postman/
│   │   ├── collection.json
│   │   └── environment.json
│   ├── .env.example
│   ├── .gitignore
│   ├── package.json
│   └── tsconfig.json                  # Strict mode required
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── lib/
│   │   │   ├── env.ts
│   │   │   └── api/
│   │   │       ├── client.ts
│   │   │       └── refreshClient.ts
│   │   ├── auth/
│   │   │   ├── AuthProvider.tsx
│   │   │   └── tokenStore.ts
│   │   ├── components/
│   │   │   ├── RequireAuth.tsx
│   │   │   └── ErrorBoundary.tsx
│   │   ├── features/
│   │   │   ├── repos/                 # repo list, add-repo flow
│   │   │   ├── graph/                 # map canvas, file/symbol panels
│   │   │   ├── insights/              # impact, cycles, health dashboards
│   │   │   └── ai/                    # explanation drawer, smart search palette
│   │   └── pages/
│   ├── .env.example
│   └── package.json
│
└── docs/
    ├── REPOVERSE_PRD.md               # this file
    └── BACKEND_PLANNING.md
```

Rules (unchanged from blueprint): never commit `.env`, `node_modules`, `dist/`, `build/`; always commit `.env.example`; one env-validation source of truth per side; TypeScript strict mode always on.

## 8. Environment Variables

### Backend `.env.example` (additions on top of blueprint baseline)

```env
# ── Server / DB / JWT / OAuth / CORS / Encryption / Email ─────────────
# (same as base blueprint — see Section 3 of PROJECT_BLUEPRINT.md)

# ── AI Provider ─────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=replace_with_key
AI_MODEL_DEFAULT=claude-sonnet-5
AI_MONTHLY_TOKEN_BUDGET_PER_USER=200000

# ── GitHub ingestion ─────────────────────────────────────────────────────
# Optional in v1 (public repos via unauthenticated API, heavily rate-limited);
# required for meaningful rate limits and private-repo support later
GITHUB_TOKEN=replace_with_pat
REPO_MAX_SIZE_MB=50
REPO_MAX_FILES=2000
REPO_MAX_FILE_SIZE_KB=200

# ── Analysis workspace ───────────────────────────────────────────────────
ANALYSIS_TMP_DIR=./tmp/clones
ANALYSIS_TIMEOUT_SECONDS=120

# ── Vector Search ─────────────────────────────────────────────────────────
VECTOR_INDEX_NAME=file_summaries_v1
```

### Frontend `.env.example` (additions)

```env
VITE_API_BASE_URL=http://localhost:5000
VITE_ENABLE_SMART_SEARCH=true
VITE_ENABLE_IMPACT_MODE=true
```

Env validation follows the exact Zod pattern in Section 3 of the base blueprint — `AI_*`, `GITHUB_*`, `REPO_*`, `ANALYSIS_*`, and `VECTOR_*` keys added to envSchema as required/optional per feature flag.

## 9. Backend Architecture

### Middleware stack order

Same 11-step order as the base blueprint (Sentry → helmet → cors → body parsing → mongo-sanitize → morgan → global rate limit → auth-route rate limit → routes → Sentry error handler → central error handler), with two additions:

- an `aiRateLimit` middleware on `/api/v1/ai/*` and any route triggering an LLM call (explanation, Smart Search answer synthesis) — per-user monthly token budget;
- a strict per-repo analysis limiter on `/api/v1/repos/*` POST/refresh routes — analysis spawns clone+parse work, the most expensive server operation.

### Standard response shapes

Identical to base blueprint — `{ success, data }` / `{ success: false, error: { code, message, fields? } }` / paginated variant. AI-generated content responses additionally carry `generatedAt` and `modelVersion` for traceability. Analysis-running endpoints return a `202`-style accepted shape with an `analysisId` the client subscribes to via Socket.io:

```json
{
  "success": true,
  "data": {
    "analysisId": "64a1...",
    "status": "queued",
    "progress": 0
  }
}
```

### Ownership & timing-safe comparisons

`assertOwnership()` and `crypto.timingSafeEqual()` patterns from the base blueprint apply unchanged — used on every repo, analysis, and insight lookup. A user only ever queries graphs of repos they own.

## 10. Code Analysis & AI Pipeline

This is the part of RepoVerse that differs most from the generic blueprint, so it gets its own section.

### 10.1 Ingestion pipeline

1. URL validation: only `https://github.com/<owner>/<repo>` accepted; owner/repo resolved via GitHub API (also confirms the repo exists and is public) — **SSRF guard**, direct IP/localhost URLs impossible by construction.
2. Size guards **before** clone: GitHub API metadata (size in KB, file count estimate) checked against `REPO_MAX_SIZE_MB` / `REPO_MAX_FILES`. Oversized repos are rejected with a clear error, not half-processed.
3. Shallow clone (`--depth 1`) into a per-analysis temp dir under `ANALYSIS_TMP_DIR` (or GitHub API tarball fetch for hosted platforms without disk); hard timeout via `ANALYSIS_TIMEOUT_SECONDS`.
4. Walk file tree; skip `node_modules`, lockfiles, binaries, files > `REPO_MAX_FILE_SIZE_KB`; cap total files.
5. Per-language parse → symbols (classes, functions, methods, exports) + edges (`imports`, `defines`, `calls`, `extends`).
6. Graph assembly: dedupe nodes, compute fan-in/fan-out, SCCs (cycles), instability metrics, dead-code candidates.
7. Persist nodes + edges + health findings + analysis record (commit SHA, durations, file count).
8. **Temp dir deleted in a `finally` block** — repo source is never retained after analysis.

### 10.2 Smart Search & embeddings

- After graph build, per-file compact summaries (path, exports, imports, top symbols — no full source) are embedded and stored in the vector index.
- Query: embed the question → vector search (top-K) merged with symbol-name matches → LLM synthesis pass over only the top candidates (cost control) → ranked locations + one-line rationale.

### 10.3 AI explanation

- Grounded: prompt = symbol source (truncated) + minimal graph context (callers, imports). Never other users' repos. Output Zod-validated; refusal path returns a structured fallback, never a blank state.
- Cached per (symbolId, commit SHA, model version).

### 10.4 Cost, compute & reliability guardrails

- Per-user monthly AI token budget enforced server-side via `aiRateLimit`.
- Per-user concurrent analysis cap (e.g. 1 running, N queued) — analysis is CPU/disk-heavy.
- Analysis results cached by commit SHA; unchanged files never re-parsed on refresh (diff-aware).
- All LLM/clone operations wrapped in retry/backoff with structured failure states visible in the UI.

### 10.5 Data retention & user control

- Repo source code is transient (temp dir, deleted post-analysis). Only the derived graph/summaries persist.
- `DELETE /users/me` cascades to repos, analyses, graph nodes/edges, embeddings, and cached AI content — confirmation-text required.
- `GET /users/me/export` includes the user's repos and derived analysis metadata (GDPR-style portability).
- Third-party GitHub PATs (future private-repo support) encrypted at rest with AES-256-GCM, never logged, never exposed to frontend.

## 11. API Documentation Standard

Uses the same template as the base blueprint (Section 5) for every endpoint. Example filled in for a RepoVerse-specific endpoint:

### POST /api/v1/repos

**Description:** Registers a GitHub repo for the user and queues an analysis run.
**Auth required:** Yes
**Minimum role:** owner

#### Request
Headers:
  Authorization: Bearer <accessToken>
  Content-Type: application/json

Body:
  {
    "url": "https://github.com/vercel/next.js",  // Required. Must be a valid github.com repo URL.
    "branch": "main"                              // Optional. Default: repo default branch.
  }

#### Response — 202 Accepted
  {
    "success": true,
    "data": {
      "repoId": "64a1...",
      "analysisId": "64a2...",
      "status": "queued",
      "progress": 0
    }
  }

#### Response — 400 Validation Error
  { "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Validation failed", "fields": { "url": ["Not a github.com repository URL"] } } }

#### Response — 422 Repo Fetch Failed
  { "success": false, "error": { "code": "REPO_NOT_ACCESSIBLE", "message": "Repository not found or not public" } }

#### Response — 413 Payload/Size Rejection
  { "success": false, "error": { "code": "REPO_TOO_LARGE", "message": "Repository exceeds the 50MB analysis limit" } }

#### Use cases
  - User pastes a repo URL in onboarding and hits "Analyze".
  - User re-adds an existing repo with a new branch.

#### Business rules
  - Same repo URL is unique per user (re-adding returns the existing repo + triggers refresh instead of a 409).
  - Analysis counts against the user's concurrent-analysis cap, not token budget.

Full endpoint set to document per module: auth, users, repos, analyses, graph, insights, ai — each following this template, plus the Error Codes Master Reference table from the base blueprint (Section 5), extended with:

| HTTP | Code | When to use |
|------|------|-------------|
| 413 | `REPO_TOO_LARGE` | Repo exceeds size/file-count limits |
| 422 | `REPO_NOT_ACCESSIBLE` | Repo missing, private without PAT, or GitHub API failure |
| 422 | `REPO_UNSUPPORTED_LANGUAGE` | No parseable source files found |
| 504 | `ANALYSIS_TIMEOUT` | Clone/parse exceeded the hard timeout |
| 429 | `AI_BUDGET_EXCEEDED` | User hit their monthly AI token budget |
| 429 | `ANALYSIS_LIMIT_EXCEEDED` | User hit concurrent/queued analysis cap |
| 409 | `ANALYSIS_IN_PROGRESS` | Refresh requested while an analysis is already running |

## 12. Backend Security Checklist

All items from the base blueprint's Section 6 apply unchanged (env/config, auth, API security, infra). RepoVerse-specific additions, given the server processes **untrusted third-party source code**:

- Repo URL allowlist: only `github.com/<owner>/<repo>` shapes accepted; owner/repo re-validated against the GitHub API before any clone — SSRF impossible by construction (no user-supplied hosts, IPs, or URLs beyond the allowlist pattern).
- Clone/exec hardening: `simple-git` with `--depth 1`; **no hooks, no submodule recursion, no post-checkout execution**; clone runs in a dedicated temp dir outside the project root and is deleted in a `finally` block.
- Hard caps enforced **before** work starts: repo size (MB), file count, per-file size, analysis wall-clock timeout — a huge repo is rejected, not half-processed.
- Path traversal guard on every file read from the clone workspace (resolve + prefix check inside the temp dir).
- **Prompt-injection defense:** analyzed repo content is untrusted data — file contents are treated as raw material, never as instructions; system prompts harden against embedded directives; LLM output is Zod-validated before persistence or display.
- Secret scanning before LLM calls: obvious API keys/tokens in analyzed source are redacted from any prompt content; raw repo source is never logged (Winston) or sent to Sentry breadcrumbs.
- Analysis endpoints rate-limited separately and strictly; per-user concurrent-analysis cap enforced server-side, not just in the client.
- Graph/insight queries always scoped by `userId` via `assertOwnership()` — cross-user repo or analysis access returns 404, never 403.
- Cached AI content keyed by commit SHA; no cross-user cache leakage.
- GitHub tokens (when private-repo support lands) encrypted with AES-256-GCM; scoped read-only.
- `GET /health` (liveness) + `GET /ready` (DB connectivity); excluded from aggressive rate limits if the host polls often.
- Socket.io connections JWT-validated before joining any analysis-progress room; room IDs are per-user.

## 13. Frontend Architecture

Axios client, refresh-token interceptor, in-memory tokenStore, AuthProvider, RequireAuth, and TanStack Query hook patterns are identical to the base blueprint (Section 7) — reuse verbatim.

### 13.1 Core Feature Modules & UI Components

- **Add-Repo Flow:** URL input (Zod-validated client-side), live validation state, analysis progress card (clone → parse → graph → embeddings) driven by Socket.io events, with failure states that explain *why* (too large / not accessible / timeout).
- **Graph Map Canvas:** `<GRAPH_LIB>` canvas — file nodes sized/colored by fan-in/fan-out, import edges, hover previews, zoom/pan, isolate-subgraph, and highlight of search/impact results.
- **Symbol Inspector Panel:** click file/class/function → source location, call sites ("called from"), exports, quick links to Explain/Impact.
- **Impact Mode:** toggle that recolors the map by affected set of the selected node, with a ranked affected-files list and direct-vs-transitive badges.
- **Cycles Dashboard:** list of detected cycles with full path visualization, severity, and suggested break-point edge.
- **Health Dashboard:** repo score gauge, per-file breakdown table (complexity/coupling/dead-code), each finding deep-linking to its map location.
- **AI Explanation Drawer:** slide-over with grounded explanation, the source snippet used, and model/timestamp traceability.
- **Smart Search / Command Palette (Cmd+K):** unified search — jump-to-file, natural-language questions, and quick actions.

### 13.2 State Management & Performance

- Server state: TanStack Query (graph snapshots keyed by analysisId; invalidate on refresh completion).
- Real-time: Socket.io progress events update query cache for in-flight analyses.
- Client state: React Context for Auth, theme, and active selection (selected node shared between map, panels, and drawer).
- Graph layout computed client-side (force/dagre); large graphs (1k+ nodes) use level-of-detail rendering and cluster-by-folder collapse.
- Rich text sanitization: DOMPurify applied to all AI-rendered content.

## 14. Frontend Security Checklist

All items from the base blueprint's Section 8 apply unchanged. RepoVerse-specific additions:

- AI-generated explanations rendered with DOMPurify (never raw `dangerouslySetInnerHTML`).
- Analyzed source snippets rendered as escaped text nodes, never HTML.
- Repo URL validated client-side with the same allowlist pattern before submit — but never trusted server-side (server re-validates).
- No repo source or analysis content persisted to localStorage/sessionStorage.
- Socket.io client authenticates with the short-lived access token; on refresh, reconnects with the new token.

## 15. Success Metrics (KPIs)

| Metric | Target (v1 pilot) |
| --- | --- |
| Time from URL paste to interactive map (≤500-file repo) | < 90 seconds |
| % of users completing first repo analysis in onboarding | > 80% |
| Smart Search answer rated "found the right place" | > 60% |
| Cycles/insights findings acted on (clicked through to location) | > 30% per analysis |
| Weekly returning users among analysts | > 40% of signups |
| AI explanation sessions per active user / week | ≥ 3 |
| AI budget overage rate | < 5% |
| Analysis failure rate (clone/parse/timeout) | < 5% |

## 16. Roadmap / Phasing

**Phase 1 (Core MVP — structural):**
- Auth (email/password + Google), users.
- Repo ingestion with all SSRF/size/timeout guards; file tree + file-level import graph.
- Graph query endpoints (tree, imports, callers at file level).
- Circular dependency detection (SCC) + cycles dashboard.
- Health score v1 (static heuristics: coupling + dead imports + file size) — full symbol-level scoring in Phase 2.
- Map canvas with file-level graph, Command Palette (jump-to-file only).

**Phase 2 (Symbol-level intelligence):**
- ts-morph symbol extraction (classes, functions, methods) + call-graph edges.
- Impact analysis (transitive dependents, risk ratings).
- Full Code Health Score (complexity + coupling + dead code, explainable findings).
- AI Code Explanation (grounded, cached by SHA).
- Analysis timeline & diff-aware refresh.

**Phase 3 (AI search & scale):**
- Smart Search with embeddings + LLM synthesis (Atlas Vector Search).
- Private repo support (encrypted PAT), branch selection.
- Python/other-language parsing; incremental graph updates.
- Persistent workspace state (saved views, pinned findings, export as JSON/Markdown report).

**Phase 4 (Ecosystem):**
- GitHub App integration (no PAT juggling), org-level dashboards.
- PR/diff impact mode: "what does this PR touch?" via GitHub API.
- Team features: shared annotations on the map, onboarding checklists.

## 17. Master Bootstrap Prompt

Adapted from the base blueprint's Section 11.1 — copy into an AI coding assistant once this PRD is approved:

```
Build a production-ready full-stack app with TypeScript for RepoVerse, an AI codebase
intelligence platform (repo → structural graph → AI insights).

Industry: Developer tools (code visualization + AI code understanding)
Primary resources: repos, analyses, graph (nodes/edges), insights, aiExplanations

── Backend ──────────────────────────────────────────────────────────────
- Monorepo: backend/ (Express 5 + Mongoose + TypeScript) and frontend/ (Vite + React + TypeScript)
- Before writing any package.json: web search each dependency for latest stable + advisories,
  confirm with `npm show <pkg> version` — never copy versions from any blueprint doc
- Structure per Section 7 of REPOVERSE_PRD.md, including services/analyzer/ and services/ai/
- Auth: Google OAuth + email/password; JWT access (15min) + refresh (7d) rotation, per base blueprint
- Repo ingestion: URL allowlist (github.com only), GitHub API metadata pre-checks, shallow clone
  with hard timeout and size caps, temp dir deleted in finally, path-traversal guarded reads
- Analyzer pipeline: parser.ts (ts-morph) → graphBuilder.ts (nodes/edges, SCC cycles, fan-in/out)
  → health.ts (complexity/coupling/dead-code) → embeddings for Smart Search
- AI integration: Anthropic SDK wrapper (services/ai/claudeClient.ts); explainer + smartSearch
  with strict Zod-validated I/O; prompt-injection hardened (repo content is untrusted data)
- Per-user AI token budget (aiRateLimit) + per-user concurrent analysis cap
- Graph/insights stored in Mongo (nodes/edges collections, SHA-versioned analyses)
- Security middleware order per base blueprint Section 4, plus strict limiters on /repos and /ai
- assertOwnership() in every controller; crypto.timingSafeEqual() for token comparisons
- Zod validation on every route; consistent { success, data } / { success:false, error } shape
- Winston + Sentry with zero repo source, tokens, or PII in logs/breadcrumbs
- Socket.io with JWT guard streaming per-analysis progress
- GET /health and GET /ready

── Frontend ─────────────────────────────────────────────────────────────
- Axios + single-flight refresh interceptor + in-memory token store (per base blueprint Section 7)
- Add-repo flow with live analysis progress (Socket.io) and explicit failure states
- Graph map canvas (<GRAPH_LIB>) with fan-in/out node styling, isolate-subgraph, highlight overlays
- Symbol inspector, impact mode, cycles dashboard, health dashboard, AI explanation drawer
- Command palette (Cmd+K) unifying jump-to-file and Smart Search
- All AI content DOMPurify-sanitized; analyzed source rendered as text nodes only

── Deliverables ─────────────────────────────────────────────────────────
1. .env.example (backend + frontend) including AI_*, GITHUB_*, REPO_*, ANALYSIS_*, VECTOR_* keys
2. Root .gitignore + .cursorignore per base blueprint Section 9
3. README with setup, seed, run instructions + CI workflow (npm ci, typecheck, test, npm audit)
4. Postman collection covering auth, repos, analyses, graph, insights, ai endpoints
5. Full API documentation per Section 11 of REPOVERSE_PRD.md for every endpoint
6. TypeScript strict-mode tsconfig for backend and frontend
```

## 18. Open Questions & Risks

- **Graph rendering library:** React Flow vs Sigma.js vs Cytoscape.js — needs a 1-day spike before Phase 1 freeze (perf on 1k+ node graphs is the deciding factor).
- **Hosted platform disk limits:** Render/Railway ephemeral disk sizes vs shallow clones of large repos — may force GitHub API tarball-only ingestion (no git binary) on some hosts.
- **Monorepo scale:** repos with 5k+ files will need file-count tiers or a paid plan; free-tier caps must be decided with the business model.
- **AI accuracy liability:** how do we disclose that explanations/answers are AI-generated guidance grounded in a graph, not authoritative documentation?
- **Private repos & trust:** users pasting PATs is a trust hurdle; GitHub App (Phase 4) is the safer path — do we wait?
- **Prompt injection in analyzed code:** mitigations are planned (Section 12) but adversarial repos targeting AI tools are an evolving threat — review before enabling "explain" on arbitrary repos.
- **Licensing/ToS:** caching and displaying third-party repo content (derived graphs, summaries) — confirm GitHub ToS compliance for derived data storage.

---

This PRD inherits its engineering conventions (security checklist, env pattern, middleware order, error shape) from the internal Full-Stack Project Blueprint v2.2. Section 6 (Tech Stack) and Sections 9–14 should be re-validated against that blueprint's Version Safety Rule before implementation begins.
