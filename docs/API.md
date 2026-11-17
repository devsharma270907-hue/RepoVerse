# RepoVerse API Reference

Base URL: `http://localhost:5000/api/v1` (configurable via `PORT`).
All responses are JSON unless noted. Source code from analyzed repositories is
**never** persisted — only derived graph data and summaries are stored.

The reference client is the React SPA in [`../frontend`](../frontend/README.md);
its `src/api/` layer mirrors every endpoint below.

---

## Conventions

### Success envelope

```json
{ "success": true, "data": { } }
```

Paginated list endpoints add a sibling `pagination` object:

```json
{
  "success": true,
  "data": [],
  "pagination": { "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
}
```

### Error envelope

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "fields": { "body.email": ["Invalid email address"] }
  }
}
```

`fields` is present for validation failures only.

### Authentication

Protected routes require a Bearer access token:

```
Authorization: Bearer <accessToken>
```

Access tokens last 15 minutes. Refresh tokens live in an **HttpOnly,
Secure-in-production, SameSite=Strict** cookie (`refresh_token`, scoped to
`/api/v1/auth`); they last 7 days and rotate on every use. Reusing a rotated
refresh token revokes the whole session family.

Ownership failures always return **404**, never 403 (existence is not
confirmed).

### Node keys

Graph nodes use stable string keys:

| Key | Meaning |
| --- | --- |
| `repo:<id>` | repository root |
| `file:<posix-relpath>` | a file, e.g. `file:src/app.ts` |
| `sym:<posix-relpath>#<name>` | a symbol, e.g. `sym:src/app.ts#main` |

Symbol names for methods are `ClassName.methodName`.

### Rate limits

| Scope | Env var | Default | Window |
| --- | --- | --- | --- |
| Global API | `RATE_LIMIT_GLOBAL_MAX` | 100 | 1 min |
| Auth endpoints | `RATE_LIMIT_AUTH_MAX` | 10 | 1 min (successes skipped) |
| Analysis creation/refresh | `RATE_LIMIT_ANALYSIS_MAX` | 30 | 1 hour |
| AI endpoints | `RATE_LIMIT_AI_MAX` | 30 | 1 min |

Exceeding a limit returns `429 RATE_LIMIT_EXCEEDED`. The AI endpoints also have
a monthly per-user token budget (`AI_MONTHLY_TOKEN_BUDGET_PER_USER`, default
200 000) → `429 AI_BUDGET_EXCEEDED`.

### Health checks

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ success: true, data: { status: "ok" } }` (liveness, no DB) |
| GET | `/ready` | — | 200 `{ status: "ready" }` or 503 `SERVICE_UNAVAILABLE` (DB) |

---

## Auth — `/auth`

### POST `/auth/register`

Creates an account and starts a session.

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "supersecret123" }
```

- `201` → `data: { user, accessToken }`, sets refresh cookie.
- `400 VALIDATION_ERROR` — invalid name/email/password (min 8 chars).
- `409 CONFLICT` — email already registered.

### POST `/auth/login`

```json
{ "email": "ada@example.com", "password": "supersecret123" }
```

- `200` → `data: { user, accessToken }`, sets refresh cookie.
- `401 INVALID_CREDENTIALS`.
- `429 ACCOUNT_LOCKED` — 5 failures for this email in 15 minutes (unknown
  emails are tracked too, so no account enumeration). The counter clears on a
  successful login.

### POST `/auth/refresh`

Requires the refresh cookie. Rotates the token and returns
`data: { accessToken }` plus a new cookie.

- `401 INVALID_REFRESH_TOKEN` / `REFRESH_TOKEN_REUSED` (reuse revokes all
  sessions for the user).

### POST `/auth/logout`

Revokes the current refresh session and clears the cookie.
`200 → data: { message: "Logged out" }`.

### GET `/auth/google`

Redirects to Google consent. The `state` parameter is an HMAC-signed value
bound to an HttpOnly SameSite=Lax cookie (10-minute TTL). Returns
`404 NOT_FOUND` when Google OAuth is not configured.

### GET `/auth/google/callback`

Validates `state` before any network call, then redirects to
`${CLIENT_URL}/oauth/callback#accessToken=<jwt>` (the refresh cookie is set on
the same response) or `${CLIENT_URL}/oauth/callback?error=<reason>` where
reason is `state_mismatch`, `not_configured` or `google_denied`.

---

## Users — `/users`

### GET `/users/me`

`200 → data: { user: { id, name, email, createdAt, githubToken } }`.
`githubToken` is `{ connected, hint?, scopes?, updatedAt? }` — never the token.

### PUT `/users/me/github-token`

Connect a GitHub PAT for private repositories. Verified against GitHub before
storage; encrypted with AES-256-GCM.

```json
{ "token": "ghp_..." }
```

- `200 → data: { githubToken: { connected: true, hint: "••••1234", scopes } }`
- `422 GITHUB_TOKEN_INVALID`, `503 GITHUB_UNAVAILABLE`.

### DELETE `/users/me/github-token`

`200 → data: { githubToken: { connected: false } }`.

### GET `/users/me/sessions`

`200 → data: { sessions: [{ id, createdAt, expiresAt, lastUsedAt?, userAgent?, current }] }`.

### DELETE `/users/me/sessions/:sessionId`

Revokes one session: `200 → data: { sessionId, revoked: true }`.

### DELETE `/users/me/sessions`

Revokes every session (includes the current one):
`200 → data: { revoked: "all", message }`.

### GET `/users/me/export`

GDPR portability. Streams a JSON attachment containing profile, repos,
analyses, saved views and pins. Never includes tokens, password hashes or
refresh sessions.

### DELETE `/users/me`

Hard-deletes the account and every derived record (repos, analyses, graph,
snapshots, embeddings, AI cache/usage, views, pins, login counters).

```json
{ "confirmation": "DELETE MY ACCOUNT" }
```

`200 → data: { message }`. `400 VALIDATION_ERROR` for a wrong phrase.

---

## Repository discovery — `/github`

### GET `/github/repos?q=&owner=&page=&limit=`

Searches GitHub repository metadata for the repo picker / command palette.
`q` and `owner` are optional individually but **at least one is required**. The
caller's stored PAT is used when present so private repositories they can
access are discoverable.

| Query | Type | Default | Notes |
| --- | --- | --- | --- |
| `q` | string ≤200 | — | free-text search |
| `owner` | GitHub login | — | adds `user:<owner>` qualifier |
| `page` | int ≥1 | 1 | |
| `limit` | int 1–50 | 20 | |

```json
{
  "success": true,
  "data": {
    "repos": [
      {
        "id": 42,
        "owner": "octo",
        "name": "repoverse",
        "fullName": "octo/repoverse",
        "description": "Codebase intelligence",
        "url": "https://github.com/octo/repoverse",
        "stars": 123,
        "forks": 7,
        "language": "TypeScript",
        "isPrivate": false,
        "defaultBranch": "main",
        "updatedAt": "2026-01-02T03:04:05Z"
      }
    ],
    "query": "repoverse",
    "owner": null
  },
  "pagination": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
}
```

Errors: `400 INVALID_REQUEST` (no `q`/`owner`), `422 REPO_NOT_ACCESSIBLE`
(rate limited / token problem), `503 GITHUB_UNAVAILABLE`.

---

## Repositories — `/repos`

### POST `/repos`

Registers (or re-opens) a GitHub repository and queues an analysis.
URL allowlist + GitHub API pre-checks (existence, visibility, size) run first.

```json
{ "url": "https://github.com/octo/repoverse", "branch": "main" }
```

`202 Accepted`:

```json
{
  "success": true,
  "data": {
    "created": true,
    "repo": { "id": "...", "owner": "octo", "name": "repoverse", "url": "...", "branch": "main", "defaultBranch": "main", "sizeKb": 512, "isPrivate": false, "createdAt": "..." },
    "analysis": { "id": "...", "repoId": "...", "status": "queued", "progress": 0, "commitSha": null, "error": null, "summary": null, "createdAt": "...", "finishedAt": null },
    "repoId": "...",
    "analysisId": "...",
    "status": "queued",
    "progress": 0
  }
}
```

The top-level `repoId` / `analysisId` / `status` / `progress` are convenience
aliases for immediate polling.

Errors: `400 VALIDATION_ERROR`, `413 REPO_TOO_LARGE`,
`422 REPO_NOT_ACCESSIBLE`, `422 REPO_UNSUPPORTED_LANGUAGE`,
`429 RATE_LIMIT_EXCEEDED`, `429 ANALYSIS_LIMIT_EXCEEDED` (per-user cap
`ANALYSIS_MAX_QUEUED_PER_USER`, default 2 non-terminal analyses).

### GET `/repos?page=&limit=`

Paginated list of the caller's repositories. `limit` ≤100, default 20.

### GET `/repos/:id`

`200 → data: { repo }`. `404 NOT_FOUND` for missing/foreign/deleted repos.

### POST `/repos/:id/refresh`

Re-runs analysis. Diff-aware when a previous analysis exists.

- `202` → `data: { analysis, repoId, analysisId, status, progress }`.
- `409 ANALYSIS_IN_PROGRESS` — this repo already has an active analysis.
- `429 RATE_LIMIT_EXCEEDED` / `429 ANALYSIS_LIMIT_EXCEEDED`.

### GET `/repos/:id/analyses?page=&limit=`

Analysis history, newest first. `data` is an array of public analysis objects.

### DELETE `/repos/:id`

Soft delete. `200 → data: { id, deleted: true }`. Re-adding the same URL later
restores the record instead of duplicating it.

### Saved views (per repo)

- `GET /repos/:id/views` → `data: { repoId, views }`.
- `POST /repos/:id/views` → `201 data: { view }`.

```json
{
  "name": "Auth flow",
  "description": "optional",
  "state": {
    "level": "symbol",
    "searchQuery": "auth",
    "focusNode": "file:src/auth.ts",
    "isolatedNode": "sym:src/auth.ts#login",
    "highlightedNodes": ["sym:src/auth.ts#login"],
    "filterKinds": ["function", "method"]
  },
  "isPinned": true
}
```

---

## Analyses — `/analyses`

### GET `/analyses/:id`

Poll status/progress.

```json
{
  "success": true,
  "data": {
    "id": "...",
    "repoId": "...",
    "status": "building_graph",
    "progress": 70,
    "commitSha": "...",
    "error": null,
    "summary": null,
    "createdAt": "...",
    "finishedAt": null
  }
}
```

Statuses: `queued → fetching → parsing → building_graph → done | failed`.
A completed analysis carries `summary`:

```json
{
  "fileCount": 6,
  "symbolCount": 6,
  "cycleCount": 1,
  "healthScore": 98,
  "skippedLarge": 0,
  "truncated": false,
  "languages": [{ "ext": "ts", "count": 6 }],
  "diff": { "reusedFiles": 4, "changedFiles": 1, "addedFiles": 1, "deletedFiles": 0 },
  "embeddedFiles": 6
}
```

`diff` appears only on refreshes; `embeddedFiles` only when embeddings are
configured.

### GET `/analyses/:id/pins`

`200 → data: { analysisId, pins: [{ id, nodeKey, note, createdAt }] }`.

### POST `/analyses/:id/pins`

```json
{ "nodeKey": "file:src/app.ts", "note": "hotspot" }
```

`201 → data: { pin }`. The node key must exist in that analysis' graph →
`404 NODE_NOT_FOUND`.

### GET `/analyses/:id/report?format=json|markdown`

- `format=json` (default) → `data.report` with metadata, `health`
  (`repoScore` + symbol-aware `files`), `cycles` and `pins`.
- `format=markdown` → `text/markdown` attachment
  `repoverse-<analysisId>.md`.

Both require a completed analysis (`409 ANALYSIS_NOT_READY` otherwise).

---

## Graph — `/graph`

All graph endpoints require a **done** analysis and enforce ownership (404).

### GET `/graph/:id?level=file|symbol`

Map payload.

- `level=file` (default): file nodes + `imports` edges only.
- `level=symbol`: repo/file/symbol nodes + `defines` / `imports` / `calls` /
  `extends` edges.

```json
{
  "success": true,
  "data": {
    "analysisId": "...",
    "commitSha": "deadbeef...",
    "level": "symbol",
    "nodes": [
      {
        "id": "sym:index.ts#main",
        "kind": "function",
        "path": "index.ts",
        "name": "main",
        "loc": 3,
        "exported": true,
        "fanIn": 0,
        "fanOut": 1,
        "endLine": 5,
        "paramCount": 0,
        "complexity": 1
      }
    ],
    "edges": [{ "from": "sym:index.ts#main", "to": "sym:c.ts#c", "kind": "calls" }]
  }
}
```

### GET `/graph/:id/tree`

Nested file tree with per-file metrics and symbol counts.

```json
{
  "success": true,
  "data": {
    "analysisId": "...",
    "fileCount": 6,
    "root": {
      "name": "/",
      "path": "",
      "type": "dir",
      "children": [
        { "name": "src", "path": "src", "type": "dir", "children": [
          { "name": "app.ts", "path": "src/app.ts", "type": "file", "loc": 120, "fanIn": 3, "fanOut": 4, "symbolCount": 7 }
        ]}
      ]
    }
  }
}
```

Directories sort before files; both are alphabetical.

### GET `/graph/:id/node?node=<key>`

Node inspector. `node` accepts `file:`, `sym:` or a bare file path (treated as
`file:<path>`).

```json
{
  "success": true,
  "data": {
    "analysisId": "...",
    "node": { "id": "sym:a.ts#a", "kind": "function", "path": "a.ts", "name": "a", "loc": 3, "exported": true, "fanIn": 0, "fanOut": 1, "endLine": 5, "paramCount": 0, "complexity": 1 },
    "incoming": [{ "key": "sym:c.ts#c", "kind": "function", "path": "c.ts", "name": "c", "loc": 3, "edgeKind": "calls" }],
    "outgoing": [{ "key": "sym:b.ts#b", "kind": "function", "path": "b.ts", "name": "b", "loc": 5, "edgeKind": "calls" }],
    "incomingCount": 1,
    "outgoingCount": 1
  }
}
```

`404 NODE_NOT_FOUND` for an unknown key.

### GET `/graph/:id/callers?node=<key>&depth=1`

Reverse traversal. Symbol keys follow `calls` edges; file keys follow `calls` +
`imports`. `depth` is clamped to 1–5 and defaults to 1.

```json
{
  "success": true,
  "data": {
    "analysisId": "...",
    "node": "sym:a.ts#a",
    "depth": 3,
    "callers": [
      { "key": "sym:c.ts#c", "depth": 1, "kind": "function", "path": "c.ts", "name": "c", "loc": 3 },
      { "key": "sym:index.ts#main", "depth": 2, "kind": "function", "path": "index.ts", "name": "main", "loc": 3 }
    ],
    "count": 2
  }
}
```

---

## Insights — `/insights`

### GET `/insights/:id/cycles`

```json
{
  "success": true,
  "data": {
    "analysisId": "...",
    "cycles": [{ "path": ["a.ts", "b.ts"], "length": 2, "severity": "low" }],
    "count": 1
  }
}
```

### GET `/insights/:id/health`

Symbol-aware, explainable health scoring. Each file has a 0–100 score, listed
findings (with `line` / `symbol` where applicable) and metrics.

```json
{
  "success": true,
  "data": {
    "analysisId": "...",
    "repoScore": 98,
    "files": [
      {
        "path": "src/big.ts",
        "score": 62,
        "penalties": [
          { "code": "HIGH_COMPLEXITY", "message": "handle() has cyclomatic complexity 22 — consider simplifying", "line": 41, "symbol": "handle" },
          { "code": "LONG_FUNCTION", "message": "handle() spans 90 lines", "line": 41, "symbol": "handle" },
          { "code": "TOO_MANY_PARAMS", "message": "handle() takes 7 parameters", "line": 41, "symbol": "handle" }
        ],
        "metrics": {
          "loc": 120,
          "fanIn": 3,
          "fanOut": 4,
          "deadCodeCandidate": false,
          "symbolCount": 5,
          "maxComplexity": 22,
          "avgComplexity": 6.4,
          "deadSymbols": 0,
          "instability": 0.57
        }
      }
    ]
  }
}
```

Finding codes: `SIZE_HOTSPOT`, `HIGH_COUPLING`, `GOD_FILE`, `DEAD_CODE`,
`HIGH_COMPLEXITY`, `LONG_FUNCTION`, `TOO_MANY_PARAMS`, `DEAD_SYMBOL`.
`repoScore` is the rounded average of file scores. `instability` is Martin's
metric `fanOut / (fanIn + fanOut)` (0 = stable, 1 = unstable).

### GET `/insights/:id/impact?node=<path|key>&direction=dependents|dependencies`

Bidirectional impact analysis.

- `direction=dependents` (default): files that transitively depend on the node
  — “what breaks if I change this?”.
- `direction=dependencies`: files the node transitively relies on.

```json
{
  "success": true,
  "data": {
    "node": "a.ts",
    "nodeKey": "file:a.ts",
    "direction": "dependents",
    "fanIn": 2,
    "fanOut": 1,
    "affected": [
      { "path": "b.ts", "depth": 1, "direct": true, "risk": "high" },
      { "path": "c.ts", "depth": 1, "direct": true, "risk": "high" },
      { "path": "index.ts", "depth": 2, "direct": false, "risk": "high" }
    ],
    "count": 3,
    "criticalPath": [
      { "path": "a.ts", "depth": 0 },
      { "path": "c.ts", "depth": 1 },
      { "path": "index.ts", "depth": 2 }
    ],
    "criticalDepth": 2
  }
}
```

Browser note: encode `#` in symbol keys (`sym:a.ts%23a`) or send the key in the
request body of an AI call.

---

## AI — `/ai/analyses/:id`

Every AI route requires auth, a per-minute rate limit and the monthly token
budget. Without `ANTHROPIC_API_KEY` they return `503 AI_NOT_CONFIGURED`.

### POST `/ai/analyses/:id/explain`

```json
{ "node": "sym:src/auth.ts#login" }
```

Explains a file or symbol, grounded in the symbol's source at the pinned
commit plus graph context. Source is fetched on demand, **recognizable secrets
are redacted** before the prompt, and repository text is marked as untrusted
data so embedded instructions are not followed.

```json
{
  "success": true,
  "data": {
    "nodeKey": "sym:src/auth.ts#login",
    "kind": "function",
    "cached": false,
    "explanation": {
      "summary": "...",
      "keyPoints": ["..."],
      "potentialIssues": ["..."]
    },
    "source": {
      "path": "src/auth.ts",
      "startLine": 10,
      "endLine": 48,
      "truncated": false,
      "text": "export async function login(input: Credentials) {\n  ..."
    },
    "graphContext": { "imports": ["src/db.ts"], "dependents": ["src/routes.ts"], "callers": ["sym:src/routes.ts#postLogin"], "callees": ["sym:src/db.ts#findUser"] },
    "redactions": 1,
    "modelVersion": "claude-sonnet-5",
    "generatedAt": "..."
  }
}
```

Results are cached per `(analysisId, nodeKey)`; `cached: true` responses do not
re-bill. `source.text` is the **redacted** excerpt that was sent to the model, so
the UI can always show the exact grounded lines next to the explanation; it is
empty for results cached before the field existed. Errors: `404 NODE_NOT_FOUND`,
`404 NODE_SOURCE_MISSING`, `429 AI_BUDGET_EXCEEDED`, `429 RATE_LIMIT_EXCEEDED`,
`502 AI_PROVIDER_ERROR`, `502 AI_INVALID_RESPONSE`.

### POST `/ai/analyses/:id/search`

```json
{ "query": "where is authentication enforced?" }
```

Keyword ranking over graph names/paths, merged with semantic retrieval when
embeddings are configured, then an LLM synthesis pass over the top 12
candidates. Falls back to deterministic keyword results on provider failure.

```json
{
  "success": true,
  "data": {
    "query": "where is authentication enforced?",
    "results": [
      { "nodeKey": "sym:src/auth.ts#login", "kind": "function", "path": "src/auth.ts", "name": "login", "why": "implements credential verification" }
    ],
    "count": 1,
    "synthesisUsed": true,
    "semanticUsed": false,
    "modelVersion": "claude-sonnet-5",
    "generatedAt": "..."
  }
}
```

`why` is deterministic ("path contains…") when synthesis is unavailable.

---

## Workspace — `/workspace`

### GET `/workspace/views/:id`

`200 → data: { view }`.

### PATCH `/workspace/views/:id`

Partial update; at least one field is required.

```json
{ "name": "Renamed", "description": null, "state": { "level": "file" }, "isPinned": false }
```

`state` is shallow-merged with the stored state. `200 → data: { view }`.

### DELETE `/workspace/views/:id`

`200 → data: { id, deleted: true }` (soft delete).

### PATCH `/workspace/pins/:id`

```json
{ "note": "follow up in sprint 12" }
```

`200 → data: { pin }`.

### DELETE `/workspace/pins/:id`

`200 → data: { id, deleted: true }` (soft delete).

---

## Real-time updates (Socket.io)

Connect with `io("http://localhost:5000", { auth: { token: <accessToken> } })`.
Invalid/missing tokens are rejected before the `connection` event. Each socket
automatically joins the server-side-only room `user:<id>`; clients cannot join
another user's room.

Events:

```json
{
  "analysisId": "...",
  "repoId": "...",
  "status": "parsing",
  "progress": 50,
  "summary": null,
  "error": null
}
```

Event name: `analysis:update`. HTTP polling via `GET /analyses/:id` remains the
fallback.

---

## Error codes

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Zod validation failed (`fields` populated) |
| 400 | `INVALID_JSON` | Malformed JSON body |
| 400 | `INVALID_REQUEST` | Missing/invalid query input |
| 400 | `OAUTH_STATE_INVALID` | Google state failed validation |
| 401 | `UNAUTHORIZED` | Missing/invalid Bearer token |
| 401 | `INVALID_CREDENTIALS` | Wrong email/password |
| 401 | `INVALID_REFRESH_TOKEN` | Missing/invalid refresh cookie |
| 401 | `REFRESH_TOKEN_REUSED` | Rotated token reused → all sessions revoked |
| 404 | `NOT_FOUND` | Missing or not owned (never 403) |
| 404 | `NODE_NOT_FOUND` | Graph node key not in this analysis |
| 404 | `NODE_SOURCE_MISSING` | Source file gone from the pinned commit |
| 409 | `CONFLICT` | Duplicate resource |
| 409 | `ANALYSIS_IN_PROGRESS` | Active analysis for this repo |
| 409 | `ANALYSIS_NOT_READY` | Insight/AI call before the analysis finished |
| 413 | `REPO_TOO_LARGE` | Repo exceeds size/file-count limits |
| 422 | `REPO_NOT_ACCESSIBLE` | Missing, private without PAT, rate limited |
| 422 | `REPO_UNSUPPORTED_LANGUAGE` | No parseable source files |
| 422 | `GITHUB_TOKEN_INVALID` | GitHub rejected the PAT |
| 429 | `ACCOUNT_LOCKED` | 5 failed logins / 15 min for this email |
| 429 | `ANALYSIS_LIMIT_EXCEEDED` | Per-user non-terminal analysis cap |
| 429 | `AI_BUDGET_EXCEEDED` | Monthly per-user token budget reached |
| 429 | `RATE_LIMIT_EXCEEDED` | Analysis or AI rate limit reached |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 502 | `GITHUB_ERROR` | Non-auth GitHub API failure |
| 502 | `AI_PROVIDER_ERROR` | Anthropic call failed after retries |
| 502 | `AI_INVALID_RESPONSE` | Model output failed Zod validation |
| 503 | `SERVICE_UNAVAILABLE` | Database not connected (`/ready`) |
| 503 | `GITHUB_UNAVAILABLE` | GitHub unreachable |
| 503 | `GITHUB_TOKEN_UNREADABLE` | Stored PAT cannot be decrypted |
| 503 | `AI_NOT_CONFIGURED` | `ANTHROPIC_API_KEY` unset |
| 504 | `ANALYSIS_TIMEOUT` | Pipeline exceeded its wall-clock budget |

---

## Configuration quick reference

See `.env.example` for the full list. Values relevant to this document:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | 5000 | HTTP port |
| `MONGODB_URI` | — | Mongo/Atlas connection string (required) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | — | ≥32 chars each (required) |
| `ENCRYPTION_KEY` | — | 64 hex chars, AES-256-GCM for PATs (required) |
| `CLIENT_URL` | `http://localhost:5173` | OAuth redirect base |
| `CORS_ORIGINS` | localhost origins | comma-separated allowlist |
| `GITHUB_TOKEN` | — | optional server-wide PAT fallback |
| `ANALYSIS_MAX_QUEUED_PER_USER` | 2 | non-terminal analyses per user |
| `ANALYSIS_TIMEOUT_SECONDS` | 120 | pipeline wall clock |
| `RATE_LIMIT_ANALYSIS_MAX` | 30 | analysis requests per hour |
| `RATE_LIMIT_AI_MAX` | 30 | AI requests per minute |
| `ANTHROPIC_API_KEY` | — | enables AI endpoints |
| `AI_MONTHLY_TOKEN_BUDGET_PER_USER` | 200000 | monthly AI token cap |
| `EMBEDDINGS_PROVIDER` | `none` | `none` / `voyage` / `openai` |
| `EMBEDDINGS_DIMENSIONS` | 1024 | must match the Atlas index |
| `SENTRY_DSN` | — | enables Sentry when set |
