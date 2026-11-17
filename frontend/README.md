# RepoVerse — Frontend

The RepoVerse SPA: point it at a GitHub repository, watch the analysis run live,
then explore the dependency graph, AI explanations, impact analysis, circular
dependencies and code health — all backed by the RepoVerse API in `../backend`.

Built with **React 19 + Vite + TypeScript (strict)**, TanStack Query, React
Router, React Flow and Socket.io.

---

## Quick start

```bash
cd frontend
cp .env.example .env      # Windows: copy .env.example .env
npm install
npm run dev               # http://localhost:5173
```

The backend must be running (default `http://localhost:5000`) and must list the
frontend origin in its `CORS_ORIGINS` allowlist, otherwise auth cookies and
requests are rejected.

> `npm install` may warn that `esbuild` has an install script pending approval
> (`npm install-scripts approve esbuild`). Vite builds fine either way; approve
> only if you trust the dependency tree.

### Environment

Only `VITE_*` variables reach the browser. They are validated at boot by
`src/lib/env.ts` with Zod — an invalid value throws immediately instead of
shipping a silently broken build.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:5000` | Backend origin, no `/api/v1` suffix |
| `VITE_ENABLE_SMART_SEARCH` | `true` | Show the AI smart-search palette command |
| `VITE_ENABLE_IMPACT_MODE` | `true` | Show the impact-analysis panel |

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | Typecheck, then production build into `dist/` |
| `npm run preview` | Serve the built bundle |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest suite (85 tests, 12 files) |
| `npm run test:watch` | Vitest in watch mode |

Tests run in jsdom with all network access mocked — they are deterministic and
offline-safe.

---

## Routes

| Path | Page | Notes |
| --- | --- | --- |
| `/login`, `/register` | `LoginPage`, `RegisterPage` | Redirect away if already signed in |
| `/oauth/callback` | `OAuthCallbackPage` | Completes Google sign-in via the backend redirect |
| `/` | `ReposPage` | Repository list + "Add repository" dialog |
| `/repos/:repoId` | `RepoPage` | Repo details, analysis history, refresh/delete |
| `/analyses/:analysisId` | `AnalysisWorkspacePage` | Live progress → map, health, cycles, impact, AI |
| `/settings` | `SettingsPage` | Profile, GitHub PAT, sessions, export, delete account |

Everything except the auth pages and the OAuth callback sits behind
`RequireAuth` inside `AppShell`.

---

## Architecture

```
src/
├── api/            axios client, endpoints, TanStack Query hooks, contract types
├── auth/           AuthProvider + in-memory tokenStore
├── components/     AppShell, RequireAuth, ui.tsx primitives, RichText, Icon
├── features/
│   ├── analysis/   live progress view
│   ├── ai/         explanation drawer (grounded source excerpt)
│   ├── auth/       auth layout + Zod form schemas
│   ├── graph/      React Flow canvas, Dagre layout, file tree, inspector
│   ├── insights/   health, cycles, impact dashboards
│   ├── palette/    ⌘K command palette provider
│   ├── realtime/   Socket.io analysis-progress hook
│   └── repos/      add-repository dialog
├── lib/            env, errors, formatting, GitHub URL + node-key helpers
├── pages/          route-level screens
└── styles/         one design system (dark/light tokens)
```

**Data flow.** Pages never call Axios directly. `src/api/hooks.ts` owns every
query key and hook; `src/api/endpoints.ts` owns every URL and unwraps the
`{ success, data }` envelope; `src/api/client.ts` adds the bearer token and
handles refresh. Types in `src/api/types.ts` are hand-written from the backend
serializers and are the single source of truth for shapes.

**Graph.** Layout is computed client-side with Dagre (left-to-right), sorted by
node id so the same graph always renders identically. Node keys follow the API
convention `file:<path>` and `sym:<path>#<name>`; `#` is percent-encoded in query
strings (`src/lib/nodeKey.ts`).

**Realtime.** `useAnalysisEvents` joins the analysis room over Socket.io and
patches the TanStack Query cache in place, so progress moves without polling
storms. On a terminal status the related queries are invalidated once.

---

## Security notes

These mirror the PRD's frontend checklist (§14) and are enforced in code:

- **Access token lives in memory only** (`auth/tokenStore.ts`). Nothing is
  written to `localStorage` or `sessionStorage`; the refresh token stays in an
  httpOnly cookie.
- **Single-flight refresh.** Concurrent 401s share one `refreshSession()` call
  to avoid triggering the backend's refresh-token reuse detection. A failed
  refresh emits `AUTH_EXPIRED_EVENT`, which clears the session globally.
- **AI output is never trusted.** Model prose goes through a tiny Markdown
  subset, is HTML-escaped, then DOMPurify-sanitized with an allowlist
  (`p/br/strong/em/code/ul/ol/li`). There is no
  `dangerouslySetInnerHTML` on raw model output.
- **Grounded explanations.** The drawer renders the exact redacted excerpt the
  model saw (`source.text`), next to the explanation — not a re-fetch of live
  source.
- **No persistence of repo source.** The client stores only ids, metadata and
  cached API responses; repository code is never written to disk.
- **Client-side Zod validation is advisory.** The server re-validates
  everything; client errors only improve UX.
- **Error copy is normalized** (`src/lib/errors.ts`) so server codes map to
  product language and unknown codes fall back to the server message.

---

## API parity

Every endpoint in [`../docs/API.md`](../docs/API.md) has a typed client call and
at least one consumer:

- auth: register, login, refresh, logout, Google sign-in callback
- users: profile, GitHub PAT set/remove, session list/revoke, export, delete
- repos: create, list, detail, refresh, analysis history, delete, saved views
- analyses: status/progress, pins, JSON/Markdown report
- graph: file/symbol graph, tree, node detail, callers
- insights: cycles, health, impact
- AI: explain, smart search
- workspace: saved view/pin update and delete
- realtime: Socket.io analysis progress

---

## Development notes

- TypeScript is strict and uses the `@/*` → `./src/*` alias. `baseUrl` is not
  used (removed in TypeScript 7).
- The design system lives in `src/styles/global.css` — colour tokens, layout,
  graph, dashboards and responsive rules. There is no CSS framework.
- Animations respect `prefers-reduced-motion`.
- `npm run build` chunks vendor code (`react`, `graph`) separately; the only
  build warnings come from third-party Rollup annotations, not our code.
