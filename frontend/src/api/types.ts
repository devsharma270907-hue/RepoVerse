/**
 * API contract types, mirroring `docs/API.md` and the backend serializers.
 * Kept hand-written (rather than generated) so the frontend has one readable
 * source of truth and no build-time dependency on the backend package.
 */

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  pagination?: Pagination;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
}

/* ── Users & auth ─────────────────────────────────────────────────────── */

export interface GithubTokenStatus {
  connected: boolean;
  hint?: string;
  scopes?: string[];
  updatedAt?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  githubToken?: GithubTokenStatus;
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  userAgent?: string;
  current: boolean;
}

/* ── Repositories & analyses ──────────────────────────────────────────── */

export interface Repo {
  id: string;
  owner: string;
  name: string;
  url: string;
  branch: string;
  defaultBranch?: string;
  sizeKb?: number;
  isPrivate: boolean;
  createdAt: string;
}

export type AnalysisStatus =
  | 'queued'
  | 'fetching'
  | 'parsing'
  | 'building_graph'
  | 'done'
  | 'failed';

export const TERMINAL_STATUSES: readonly AnalysisStatus[] = ['done', 'failed'];

export interface AnalysisSummary {
  fileCount: number;
  symbolCount: number;
  cycleCount: number;
  healthScore: number;
  skippedLarge: number;
  truncated: boolean;
  languages: Array<{ ext: string; count: number }>;
  diff?: {
    reusedFiles: number;
    changedFiles: number;
    addedFiles: number;
    deletedFiles: number;
  };
  embeddedFiles?: number;
}

export interface Analysis {
  id: string;
  repoId: string;
  status: AnalysisStatus;
  progress: number;
  commitSha: string | null;
  error: { code: string; message: string } | null;
  summary: AnalysisSummary | null;
  createdAt: string;
  finishedAt: string | null;
}

/* ── Graph ────────────────────────────────────────────────────────────── */

export type GraphNodeKind = 'repo' | 'file' | 'class' | 'function' | 'method';
export type GraphEdgeKind = 'imports' | 'defines' | 'calls' | 'extends';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  path: string | null;
  name: string | null;
  loc: number | null;
  exported: boolean | null;
  fanIn: number;
  fanOut: number;
  endLine: number | null;
  paramCount: number | null;
  complexity: number | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface GraphPayload {
  analysisId: string;
  commitSha: string | null;
  level: 'file' | 'symbol';
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  loc?: number;
  fanIn?: number;
  fanOut?: number;
  symbolCount?: number;
  children?: TreeNode[];
}

export interface GraphTree {
  analysisId: string;
  fileCount: number;
  root: TreeNode;
}

export interface Neighbour {
  key: string;
  kind: GraphNodeKind | null;
  path: string | null;
  name: string | null;
  loc: number | null;
  edgeKind?: GraphEdgeKind;
}

export interface NodeDetail {
  analysisId: string;
  node: GraphNode;
  incoming: Neighbour[];
  outgoing: Neighbour[];
  incomingCount: number;
  outgoingCount: number;
}

export interface CallerEntry {
  key: string;
  depth: number;
  kind: GraphNodeKind | null;
  path: string | null;
  name: string | null;
  loc: number | null;
}

export interface CallersPayload {
  analysisId: string;
  node: string;
  depth: number;
  callers: CallerEntry[];
  count: number;
}

/* ── Insights ─────────────────────────────────────────────────────────── */

export interface HealthPenalty {
  code: string;
  message: string;
  line?: number;
  symbol?: string;
}

export interface FileHealthMetrics {
  loc: number;
  fanIn: number;
  fanOut: number;
  deadCodeCandidate: boolean;
  symbolCount: number;
  maxComplexity: number;
  avgComplexity: number;
  deadSymbols: number;
  instability: number;
}

export interface FileHealth {
  path: string;
  score: number;
  penalties: HealthPenalty[];
  metrics: FileHealthMetrics;
}

export interface HealthPayload {
  analysisId: string;
  repoScore: number;
  files: FileHealth[];
}

export type CycleSeverity = 'low' | 'medium' | 'high';

export interface Cycle {
  path: string[];
  length: number;
  severity: CycleSeverity;
}

export interface CyclesPayload {
  analysisId: string;
  cycles: Cycle[];
  count: number;
}

export type ImpactDirection = 'dependents' | 'dependencies';
export type ImpactRisk = 'low' | 'medium' | 'high';

export interface ImpactAffected {
  path: string;
  depth: number;
  direct: boolean;
  risk: ImpactRisk;
}

export interface CriticalPathStep {
  path: string;
  depth: number;
}

export interface ImpactPayload {
  node: string;
  nodeKey: string | null;
  direction: ImpactDirection;
  fanIn: number;
  fanOut: number;
  affected: ImpactAffected[];
  count: number;
  criticalPath: CriticalPathStep[];
  criticalDepth: number;
  message?: string;
}

/* ── AI ───────────────────────────────────────────────────────────────── */

export interface Explanation {
  summary: string;
  keyPoints: string[];
  potentialIssues: string[];
}

export interface ExplainPayload {
  nodeKey: string;
  kind: GraphNodeKind;
  cached: boolean;
  explanation: Explanation;
  source: {
    path: string;
    startLine: number;
    endLine: number;
    truncated: boolean;
    /** Redacted excerpt that was sent to the model (present on fresh responses). */
    text?: string;
  };
  graphContext?: {
    imports: string[];
    dependents: string[];
    callers: string[];
    callees: string[];
  };
  redactions?: number;
  modelVersion: string;
  generatedAt: string;
}

export interface SearchResult {
  nodeKey: string;
  kind: GraphNodeKind;
  path: string | null;
  name: string | null;
  why: string;
}

export interface SearchPayload {
  query: string;
  results: SearchResult[];
  count: number;
  synthesisUsed: boolean;
  semanticUsed: boolean;
  modelVersion?: string;
  generatedAt?: string;
  message?: string;
}

/* ── Workspace ────────────────────────────────────────────────────────── */

export interface SavedViewState {
  level: 'file' | 'symbol';
  searchQuery?: string;
  focusNode?: string;
  isolatedNode?: string;
  highlightedNodes: string[];
  filterKinds: string[];
}

export interface SavedView {
  id: string;
  repoId: string;
  name: string;
  description: string | null;
  state: SavedViewState;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Pin {
  id: string;
  repoId: string;
  analysisId: string;
  nodeKey: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── GitHub discovery ─────────────────────────────────────────────────── */

export interface GithubRepo {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  stars: number;
  forks: number;
  language: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  updatedAt: string;
}
