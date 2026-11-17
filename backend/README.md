# RepoVerse — Backend

AI-powered codebase intelligence API (Express 5 + Mongoose + TypeScript), built to the
conventions in `../docs/REPOVERSE_PRD.md` and the internal Full-Stack Project Blueprint v2.2.

## Features (implemented — Phases 1–3)

- **Auth**: email/password register · login · JWT access (15m) + refresh (7d, HttpOnly cookie,
  SHA-256 digest + bcrypt hashed in DB, rotated on use, reuse-detection revokes all sessions) ·
  account lockout after 5 failed logins in 15 minutes (TTL-indexed, applies to unknown emails
  too — no enumeration) · active-session list/revoke (`/users/me/sessions`)
- **Google OAuth (PRD §6)**: stateless Passport.js flow — `GET /auth/google` issues an
  HMAC-signed CSRF `state` bound to an HttpOnly SameSite=Lax cookie; the callback validates
  state **before** any network call (timing-safe, ≤10min TTL), then issues the same JWT pair
  as password login (refresh cookie + access token in the redirect **fragment**, which the
  frontend reads and clears). Accounts link by `googleId` → verified email → new OAuth-only
  user (no password). Strategy registers only when `GOOGLE_CLIENT_ID`/`SECRET` exist — the
  routes answer 404 JSON otherwise. Token/userinfo endpoints are env-overridable
  (`GOOGLE_TOKEN_URL` / `GOOGLE_USERINFO_URL`) for proxies and test doubles
- **Users & data control**: `GET /users/me` + encrypted GitHub PAT management ·
  `GET /users/me/sessions` (current-session flag, no secrets) · `DELETE
  /users/me/sessions/:sessionId` · `DELETE /users/me/sessions` (sign out everywhere) ·
  `GET /users/me/export` (GDPR portability: profile, repos, analyses, saved views, pins —
  never tokens, password hashes or refresh sessions) · `DELETE /users/me` with the typed
  confirmation `DELETE MY ACCOUNT`, hard-deleting every derived record (repos, analyses,
  graph, snapshots, embeddings, AI cache/usage, views, pins, login counters) and cancelling
  queued/in-flight analyses
- **Repos + analyzer pipeline**: register a GitHub repo (URL allowlist + GitHub API
  pre-checks for existence/visibility/size) → queued analysis runs through
  `queued → fetching → parsing → building_graph → done/failed` with progress polling;
  one active analysis per repo, a per-user non-terminal cap
  (`ANALYSIS_MAX_QUEUED_PER_USER`, default 2) and an hourly analysis-creation rate
  limit (`RATE_LIMIT_ANALYSIS_MAX`, default 30) protect the worker queue; hard
  wall-clock timeout; soft delete with restore-on-re-add. Source is shallow-cloned
  into a temp workspace and **deleted in a `finally` block** — only the derived graph
  is retained
- **Repository discovery (PRD §4.9)**: `GET /api/v1/github/repos?q=&owner=&page=&limit=`
  searches public GitHub metadata for the repo picker / command palette; a connected
  PAT is used when present, and registration still goes through the full validation
  pipeline
- **Symbol-level analysis (Phase 2)**: ts-morph parsing of TS/JS/JSX — files with LOC +
  resolved internal imports, symbols (functions/classes/methods/exported arrow consts),
  best-effort `calls` and `extends` edges; persisted as `GraphNode` / `GraphEdge`
  collections
- **Multi-language support (PRD §4.1)**: TypeScript/JavaScript get full ts-morph parsing;
  Python gets best-effort symbols (classes, methods, functions), absolute/relative imports
  and call edges; every other supported source language (Go, Rust, Java, Ruby, PHP, C/C++,
  Swift, Kotlin, Scala, shell, SQL, Vue/Svelte, …) is ingested as file-level nodes with LOC
  and no symbol/import edges. Binaries, lockfiles and build/vendor dirs are excluded.
  Diff-aware refresh reuses unchanged Python/fallback files exactly like TS files
- **Dependency graph API**: file-level (default, for the map canvas) or symbol-level
  (includes `calls` and `extends` edges) nodes + edges per analysis, plus navigation endpoints:
  nested file **tree** with LOC/fan-in/out/symbol counts, single-**node** inspector
  (incoming/outgoing neighbours with edge kinds), and reverse **callers** traversal
  (depth 1–5)
- **Insights**: circular-dependency detection (Tarjan SCC over the import graph, with
  severity), Impact Analysis (BFS in both directions — `dependents` for "what breaks
  if I change this?", `dependencies` for "what does this rely on?" — with depth/risk,
  direct `fanIn`/`fanOut` and the deepest `criticalPath`), and a symbol-aware Code
  Health Score: file penalties (SIZE_HOTSPOT, HIGH_COUPLING, GOD_FILE, DEAD_CODE) plus
  symbol findings (HIGH_COMPLEXITY, LONG_FUNCTION, TOO_MANY_PARAMS, DEAD_SYMBOL) that
  carry `line`/`symbol` deep links and per-file complexity metrics
- **AI Code Explanation** (PRD §4.6): grounded Claude explanation of any file or symbol
  node — source fetched on demand from GitHub raw at the pinned commit (never stored),
  recognizable secrets redacted before leaving the server, the source/graph context
  explicitly marked as untrusted data (prompt-injection defense), prompt includes a
  compact graph context (imports, dependents, callers, callees), and the response
  carries the EXACT source lines used (plus a `redactions` count). Output is
  Zod-validated; cached per (analysis, node) so unchanged code never re-bills;
  per-minute rate limit + per-user monthly token budget enforced server-side
  (`aiRateLimit` / `aiBudget` middleware, `AiUsage` collection)
- **Smart Search** (PRD §4.7): natural-language query over an analysis' graph —
  keyword ranking across symbol names + file paths **merged with semantic retrieval**
  over per-file embeddings, then an LLM synthesis pass over ONLY the top 12 candidates
  for ranked results with a one-line "why this matched" rationale. Falls back to
  deterministic keyword results when the provider is down or unconfigured
- **Semantic index / Atlas Vector Search** (PRD §10.2): after the graph is built, each
  file's compact summary (path, exports, imports, symbol names — **never source**) is
  embedded and stored in `FileEmbedding`. Vectors are scoped per analysis and pruned to
  the latest + predecessor. Retrieval uses Atlas `$vectorSearch` when the index exists
  (`atlas/file_summaries_v1.json`), otherwise an in-process cosine fallback — so local
  dev, CI and non-Atlas Mongo all work. Unchanged files reuse the previous analysis'
  vectors instead of re-billing the provider. Embedding generation is **best-effort**:
  a provider outage never fails an analysis (search stays keyword-only), and
  `summary.embeddedFiles` reports how many files were indexed
- **Real-time progress (Socket.io 4.8)**: JWT-authenticated handshake (`auth.token`,
  rejected before `connection`); every socket auto-joins the server-side-only
  `user:<id>` room and the pipeline streams ordered `analysis:update` events
  (status/progress/summary) — a client physically cannot receive another user's
  events; HTTP polling keeps working as a fallback
- **Stale-analysis recovery cron** (PRD §10.4): every 60s, interrupted analyses
  (server restart/timeout) are failed with `ANALYSIS_TIMEOUT` instead of spinning
  forever, and orphaned clone workspaces older than 1h are reaped
- **Private repos (PRD §12)**: a user can connect a GitHub PAT for private-repo
  analysis. The token is verified against GitHub **before** storage, encrypted with
  AES-256-GCM (unique IV + auth tag, key in `ENCRYPTION_KEY`), excluded from queries by
  default (`select: false`), and never returned — clients only see
  `{ connected, hint: "••••1234", scopes, updatedAt }`. A connected PAT authorizes
  metadata checks, the shallow clone (via `http.extraheader` passed through
  `GIT_CONFIG_*` env vars — never in argv) and on-demand source reads for AI
  explanation. Repos record `isPrivate`; `DELETE` forgets the token
- **Diff-aware refresh (PRD §4.8)**: every analysis stores derived per-file
  snapshots — path, sha256, LOC, resolved imports, symbol summaries, call-name sets
  (never source text, §10.5). Re-analyzing the same tree reuses **all** files; on a new
  commit only changed/added files reach ts-morph, deleted files drop out, and call
  edges are re-resolved across the merged set — so the incremental graph is identical
  to a full parse (asserted in tests). The response summary carries
  `diff: { reusedFiles, changedFiles, addedFiles, deletedFiles }`. Snapshots for
  older analyses are pruned (latest + predecessor only)
- **Persistent workspace state (PRD Phase 3)**: saved map views per repo (focus,
  isolation, highlighted nodes, filters, search) with owner-scoped CRUD; pinned findings
  per completed analysis (validated against the graph, optional note); and a one-click
  report export — structured JSON or a Markdown attachment with repo metadata, commit SHA,
  health score, hotspots, cycles and pins
- **Optional error monitoring**: `@sentry/node` initializes only when `SENTRY_DSN` is set
  (local dev and CI make no network calls). `beforeSend` scrubs auth headers, cookies,
  request bodies, query strings, breadcrumbs and user PII (email/IP/username); 5xx errors
  and unhandled rejections are captured, and shutdown flushes buffered events. Trace
  sampling defaults to 0 (errors only) via `SENTRY_TRACES_SAMPLE_RATE`
- **Health**: `GET /health` (liveness), `GET /ready` (DB readiness)
- **Tests**: 126 Vitest + Supertest tests (auth flows incl. rotation/reuse-revocation,
  lockout and session management, repos pipeline with a mocked fetcher + committed fixture
  project, analyzer unit tests for parser/graph/health incl. symbol complexity metrics,
  Python/fallback parsing, diff-aware refresh incl. full-parse parity, graph/insights
  endpoints incl. tree/node/callers and bidirectional impact, AI
  explain/search/budget with a mocked SDK client plus prompt secret-redaction tests,
  live socket.io client tests incl. user-scoping, cron sweeps, ownership guards,
  Google OAuth round trip against a local OIDC test double, GitHub PAT
  encryption/verification/private-repo flow, GitHub discovery with a stubbed fetch,
  embeddings provider/batching/semantic fallback/reuse, workspace views/pins/report,
  queue-limit rules, GDPR export and full account-deletion cascade, Sentry scrubber,
  and disabled-monitoring behavior — all offline) against in-memory MongoDB
- Blueprint security middleware: helmet · explicit CORS allowlist · 10kb body limit ·
  NoSQL sanitize · configurable rate limits · central error handler with the
  standard `{ success, error: { code, message, fields? } }` shape

Roadmap complete for v1: all PRD Phase 1–3 features are implemented (including
multi-language parsing, persistent workspace state and reports). The React SPA that
consumes this API lives in [`../frontend`](../frontend/README.md). Phase 4 (GitHub
App, organizations, CI integrations) is out of scope.

> **AI configuration**: AI endpoints work without any keys — they answer
> `503 AI_NOT_CONFIGURED` until `ANTHROPIC_API_KEY` is set. Node 20+ required by the
> SDK; API version 2026-10-21 (SDK 1.x) — sampling params are not sent.
>
> **Socket.io**: clients authenticate with `io(url, { auth: { token: <accessToken> } })`
> and listen for `analysis:update` events. CORS uses the same `CORS_ORIGINS` allowlist
> as HTTP.
>
> **Encryption at rest**: `ENCRYPTION_KEY` is REQUIRED (64 hex chars —
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
> It encrypts per-user GitHub PATs with AES-256-GCM. Rotating it makes stored
> PATs unreadable (`503 GITHUB_TOKEN_UNREADABLE`) — users must reconnect.
>
> **Private repos**: connect a PAT via `PUT /users/me/github-token`, then register
> the repo URL as usual. The token is verified with GitHub before storage and is
> used for metadata, cloning and AI source reads; it is never returned by the API.
>
> **Embeddings / Smart Search**: set `EMBEDDINGS_PROVIDER` to `voyage` or `openai`
> plus `EMBEDDINGS_API_KEY` to enable semantic retrieval (Anthropic has no embeddings
> API). Defaults: `voyage-code-4` / `text-embedding-3-small`, 1024 dimensions,
> batches of 64, max 500 files per analysis. On MongoDB Atlas, create the vector index
> from `atlas/file_summaries_v1.json` using `VECTOR_INDEX_NAME` (default
> `file_summaries_v1`) and keep `EMBEDDINGS_DIMENSIONS`/model in sync with its
> `numDimensions`. Without Atlas the API automatically uses an in-process cosine
> fallback, and with `none` Smart Search is keyword-only. Embedding failures are
> logged, never fatal to an analysis.
>
> **Error monitoring**: set `SENTRY_DSN` to enable Sentry — otherwise it stays fully
> disabled and no network calls are made. `SENTRY_ENVIRONMENT` overrides the environment
> label and `SENTRY_TRACES_SAMPLE_RATE` (0–1, default 0) enables performance tracing.
> The SDK collects no request headers, cookies, bodies, query params or user PII, and
> `beforeSend` additionally strips them; only 5xx `AppError`s and unhandled
> errors/rejections are captured.
>
> **Google OAuth**: set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (and
> `GOOGLE_CALLBACK_URL`, default `http://localhost:5000/api/v1/auth/google/callback`)
> to enable `GET /auth/google`. Without them the routes answer `404 NOT_FOUND` and the
> rest of the app is unaffected. Callback failures redirect to
> `${CLIENT_URL}/oauth/callback?error=state_mismatch|not_configured|google_denied`.
> `GOOGLE_TOKEN_URL` / `GOOGLE_USERINFO_URL` optionally override Google's endpoints
> (corporate proxy or a self-hosted OIDC gateway).

> **Known advisory**: `npm audit` reports 3 moderate findings through
> `ts-morph → @ts-morph/common → minimatch` (glob DoS amplification). The only "fix" is
> downgrading ts-morph to v17 (breaking). ts-morph only parses source cloned into our
> own server process, so the exposure is minimal — CI gates at `--audit-level=high`.

## Setup

```bash
cd backend
npm install
cp .env.example .env         # then set JWT secrets + Mongo URI
```

Generate JWT secrets:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Run (pick one)

```bash
# Option A — zero-setup: in-memory MongoDB (dev/test only)
npm run dev:memory

# Option B — local MongoDB or MongoDB Atlas
#   set MONGODB_URI in .env, then:
npm run dev
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server with watch (uses `.env`) |
| `npm run dev:memory` | Dev server with in-memory MongoDB (`.env.memory` + `.env`) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled output |
| `npm run typecheck` | Strict TypeScript check, no emit |
| `npm test` | Run the Vitest suite (in-memory MongoDB, mocked GitHub) |
| `npm run test:watch` | Vitest in watch mode |

## CI baseline (blueprint Section 9)

```bash
npm ci
npm run typecheck
npm test
npm audit --audit-level=high
```

GitHub Actions runs this exact baseline on every push/PR — see
`.github/workflows/ci.yml` at the repo root.

## Postman

1. Import `postman/collection.json`
2. Import `postman/environment.json` and select it
3. Set `email`, `password` and `repoUrl` in the environment, then run requests top to bottom.
   Register/Login save `accessToken`; repo, view, pin and session requests save
   `repoId` / `analysisId` / `viewId` / `pinId` / `sessionId` automatically, and the
   refresh cookie lives in Postman's cookie jar. The GitHub discovery folder searches
   repositories without registering them; graph navigation requests use
   `analysisId` from the register response.

## API surface (current)

Full per-endpoint reference with request/response examples:
[`../docs/API.md`](../docs/API.md).

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/register` | — | 201 · sets refresh cookie |
| POST | `/api/v1/auth/login` | — | 200 · sets refresh cookie |
| POST | `/api/v1/auth/refresh` | cookie | rotates refresh token |
| POST | `/api/v1/auth/logout` | cookie | revokes session |
| GET | `/api/v1/auth/google` | — | 302 → Google consent (404 if not configured) |
| GET | `/api/v1/auth/google/callback` | state cookie | 302 → client `#accessToken=…` or `?error=` |
| GET | `/api/v1/users/me` | Bearer | current user + `githubToken` status (hint only) |
| GET | `/api/v1/users/me/sessions` | Bearer | active sessions + `current` flag (no secrets) |
| DELETE | `/api/v1/users/me/sessions/:sessionId` | Bearer | revoke one session |
| DELETE | `/api/v1/users/me/sessions` | Bearer | revoke every session (sign out everywhere) |
| GET | `/api/v1/users/me/export` | Bearer | GDPR data portability (JSON attachment, no secrets) |
| DELETE | `/api/v1/users/me` | Bearer | hard delete account + all derived data (typed confirmation) |
| PUT | `/api/v1/users/me/github-token` | Bearer | connect PAT (verified, AES-256-GCM at rest) |
| DELETE | `/api/v1/users/me/github-token` | Bearer | forget stored PAT |
| POST | `/api/v1/repos` | Bearer | register repo + queue analysis · 202 (`repoId`/`analysisId` aliases) |
| GET | `/api/v1/repos` | Bearer | paginated list |
| GET | `/api/v1/repos/:id` | Bearer | repo detail |
| POST | `/api/v1/repos/:id/refresh` | Bearer | re-run analysis · 202 / 409 if active · diff-aware (summary.diff) |
| GET | `/api/v1/repos/:id/analyses` | Bearer | analysis history, paginated |
| GET | `/api/v1/repos/:id/views` | Bearer | saved workspace views for this repo |
| POST | `/api/v1/repos/:id/views` | Bearer | create saved view · 201 |
| DELETE | `/api/v1/repos/:id` | Bearer | soft delete |
| GET | `/api/v1/github/repos?q=&owner=&page=&limit=` | Bearer | GitHub repository discovery (metadata only) |
| GET | `/api/v1/workspace/views/:id` | Bearer | get saved view |
| PATCH | `/api/v1/workspace/views/:id` | Bearer | rename/re-pin/patch view state |
| DELETE | `/api/v1/workspace/views/:id` | Bearer | soft delete saved view |
| GET | `/api/v1/analyses/:id` | Bearer | analysis status/progress polling |
| GET | `/api/v1/analyses/:id/pins` | Bearer | pinned findings for a done analysis |
| POST | `/api/v1/analyses/:id/pins` | Bearer | pin a graph node (optional note) · 201 |
| GET | `/api/v1/analyses/:id/report?format=json\|markdown` | Bearer | JSON report or Markdown attachment |
| PATCH | `/api/v1/workspace/pins/:id` | Bearer | update a pin note |
| DELETE | `/api/v1/workspace/pins/:id` | Bearer | soft delete a pin |
| GET | `/api/v1/graph/:id?level=file\|symbol` | Bearer | map nodes + edges (file or symbol level) |
| GET | `/api/v1/graph/:id/tree` | Bearer | nested file tree with LOC/fan-in/out/symbol counts |
| GET | `/api/v1/graph/:id/node?node=<key>` | Bearer | node inspector: incoming/outgoing neighbours |
| GET | `/api/v1/graph/:id/callers?node=<key>&depth=1` | Bearer | reverse caller traversal (depth 1–5) |
| GET | `/api/v1/insights/:id/cycles` | Bearer | circular dependencies (Tarjan SCC) |
| GET | `/api/v1/insights/:id/health` | Bearer | symbol-aware per-file health scores + repo average |
| GET | `/api/v1/insights/:id/impact?node=<path\|key>&direction=dependents\|dependencies` | Bearer | impact + critical path |
| POST | `/api/v1/ai/analyses/:id/explain` | Bearer | grounded AI explanation of a node |
| POST | `/api/v1/ai/analyses/:id/search` | Bearer | Smart Search (keyword + semantic + LLM synthesis) |
| GET | `/health` | — | liveness |
| GET | `/ready` | — | readiness (DB) |

### Error codes (beyond blueprint baseline)

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `INVALID_JSON` | Malformed JSON body |
| 400 | `INVALID_REQUEST` | Missing/invalid query input (e.g. discovery without `q`/`owner`) |
| 400 | `OAUTH_STATE_INVALID` | Google callback state failed validation (forged/expired/mismatched cookie) |
| 409 | `ANALYSIS_IN_PROGRESS` | Refresh while an analysis is active for this repo |
| 409 | `ANALYSIS_NOT_READY` | Insight endpoint hit before analysis completes |
| 413 | `REPO_TOO_LARGE` | Repo exceeds size/file-count limits |
| 422 | `REPO_NOT_ACCESSIBLE` | Missing, private without a connected PAT, or GitHub API failure |
| 422 | `REPO_UNSUPPORTED_LANGUAGE` | No parseable source files found (TS/JS, Python, or other supported source languages) |
| 404 | `NODE_NOT_FOUND` | Explain/search/graph node key not in this graph |
| 404 | `NODE_SOURCE_MISSING` | Source file gone from the pinned commit |
| 429 | `ACCOUNT_LOCKED` | 5 failed logins for this email within 15 minutes (unknown emails included) |
| 429 | `ANALYSIS_LIMIT_EXCEEDED` | Per-user non-terminal analysis cap reached |
| 429 | `AI_BUDGET_EXCEEDED` | Monthly per-user AI token budget reached |
| 429 | `RATE_LIMIT_EXCEEDED` | Analysis-creation or AI per-minute/hour limit reached |
| 502 | `AI_INVALID_RESPONSE` | Model output failed Zod validation |
| 502 | `AI_PROVIDER_ERROR` | Anthropic API call failed after retries |
| 422 | `GITHUB_TOKEN_INVALID` | GitHub rejected the PAT being connected |
| 503 | `GITHUB_TOKEN_UNREADABLE` | Stored PAT cannot be decrypted (key rotated) |
| 503 | `AI_NOT_CONFIGURED` | `ANTHROPIC_API_KEY` not set on the server |
| 503 | `GITHUB_UNAVAILABLE` | GitHub API unreachable |
| 504 | `ANALYSIS_TIMEOUT` | Pipeline exceeded hard wall-clock |
