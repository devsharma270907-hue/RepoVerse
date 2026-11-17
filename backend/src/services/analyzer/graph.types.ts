/**
 * Graph data contract (PRD §4.1) — Phase 2 pipeline target types.
 *
 * The analyzer's job is to fill these structures from parsed source files:
 *   nodes: repo → file → class/function/method symbols
 *   edges : imports | defines | calls | extends
 * Every RepoVerse view (map, impact, cycles, health) is a query over these.
 * The Phase-1 skeleton stores file-level summaries only; parser.ts
 * (ts-morph) fills symbol nodes and call edges in Phase 2.
 */

export type GraphNodeKind = 'repo' | 'file' | 'class' | 'function' | 'method';

export type GraphEdgeKind = 'imports' | 'defines' | 'calls' | 'extends';

export interface GraphNode {
  key: string; // stable id, e.g. "file:src/app.ts" or "fn:src/app.ts#bootstrap"
  kind: GraphNodeKind;
  repoId: string;
  path?: string; // file path for file-level nodes
  name?: string; // symbol name for symbol-level nodes
  loc?: number; // lines of code
  fanIn?: number;
  fanOut?: number;
  endLine?: number;
  paramCount?: number;
  complexity?: number;
}

export interface GraphEdge {
  from: string; // node key
  to: string; // node key
  kind: GraphEdgeKind;
  loc?: number; // source line for calls
}
