import { ParsedFile, ParseResult, fileKey, symbolKey } from './parser';
import { toPosix } from './ignore';

/**
 * Assembles the analysis graph (PRD §4.1 / §10.1 step 6):
 *  - nodes: repo / file / symbol
 *  - edges: defines | imports | calls
 *  - fan-in/fan-out per file
 *  - import-graph cycles via Tarjan SCC
 */

export interface GraphNodeData {
  key: string;
  kind: 'repo' | 'file' | 'class' | 'function' | 'method';
  path?: string;
  name?: string;
  loc?: number;
  exported?: boolean;
  fanIn: number;
  fanOut: number;
  // Static health metrics (PRD §4.5) — symbols only
  endLine?: number;
  paramCount?: number;
  complexity?: number;
}

export interface GraphEdgeData {
  from: string;
  to: string;
  kind: 'defines' | 'imports' | 'calls' | 'extends';
}

export interface CycleInfo {
  path: string[]; // file paths forming the cycle, in order
  length: number;
  severity: 'low' | 'medium' | 'high';
}

export interface BuiltGraph {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  cycles: CycleInfo[];
}

const ENTRY_BASENAMES = new Set([
  'index',
  'main',
  'app',
  'server',
  'mod',
  'cli',
  '__init__',
]);

export function isEntryFile(relPath: string): boolean {
  const base = toPosix(relPath).split('/').pop() ?? '';
  const stem = base.replace(/\.[^.]+$/, '').toLowerCase();
  return ENTRY_BASENAMES.has(stem);
}

/** Tarjan SCC over the file import graph. */
export function detectCycles(files: ParsedFile[]): CycleInfo[] {
  const graph = new Map<string, string[]>();
  for (const file of files) graph.set(file.path, [...file.imports]);

  const indexMap = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;
  const sccs: string[][] = [];

  const strongConnect = (v: string): void => {
    indexMap.set(v, counter);
    lowlink.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);

    for (const w of graph.get(v) ?? []) {
      if (!graph.has(w)) continue;
      if (!indexMap.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indexMap.get(w)!));
      }
    }

    if (lowlink.get(v) === indexMap.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) sccs.push(scc); // self-imports (length 1) ignored
    }
  };

  for (const v of graph.keys()) {
    if (!indexMap.has(v)) strongConnect(v);
  }

  return sccs.map((scc) => {
    // rotate so the path reads as a loop a → b → c → a
    const path = [...scc];
    const fanIns = scc.map((p) => files.find((f) => f.path === p)?.imports.length ?? 0);
    const maxFan = Math.max(0, ...fanIns);
    const severity: CycleInfo['severity'] =
      scc.length >= 4 || maxFan >= 5 ? 'high' : scc.length >= 3 ? 'medium' : 'low';
    return { path, length: scc.length, severity };
  });
}

export function buildGraph(parse: ParseResult): BuiltGraph {
  const nodes = new Map<string, GraphNodeData>();
  const edges = new Map<string, GraphEdgeData>();

  const addNode = (node: GraphNodeData): void => {
    nodes.set(node.key, node);
  };
  const addEdge = (edge: GraphEdgeData): void => {
    edges.set(`${edge.kind}:${edge.from}->${edge.to}`, edge);
  };

  // files + defines + imports
  for (const file of parse.files) {
    const fKey = fileKey(file.path);
    addNode({ key: fKey, kind: 'file', path: file.path, loc: file.loc, fanIn: 0, fanOut: file.imports.length });

    for (const target of file.imports) {
      addNode({ key: fileKey(target), kind: 'file', path: target, fanIn: 0, fanOut: 0 });
      addEdge({ from: fKey, to: fileKey(target), kind: 'imports' });
    }

    for (const sym of file.symbols) {
      addNode({
        key: sym.key,
        kind: sym.kind === 'class' ? 'class' : sym.kind === 'method' ? 'method' : 'function',
        path: file.path,
        name: sym.name,
        loc: sym.line,
        exported: sym.exported,
        fanIn: 0,
        fanOut: sym.callees.length,
        ...(sym.endLine !== undefined ? { endLine: sym.endLine } : {}),
        ...(sym.paramCount !== undefined ? { paramCount: sym.paramCount } : {}),
        ...(sym.complexity !== undefined ? { complexity: sym.complexity } : {}),
      });
      addEdge({ from: fKey, to: sym.key, kind: 'defines' });
    }
  }

  // calls (symbol → symbol)
  for (const file of parse.files) {
    for (const sym of file.symbols) {
      for (const callee of sym.callees) {
        addEdge({ from: sym.key, to: callee, kind: 'calls' });
      }
    }
  }

  // extends (class → base class) — resolved best-effort by simple class name,
  // mirroring the call-edge over-approximation (PRD §10.1 step 5).
  const classesByName = new Map<string, string[]>();
  for (const file of parse.files) {
    for (const sym of file.symbols) {
      if (sym.kind !== 'class') continue;
      const simple = sym.name.split('.').pop() ?? sym.name;
      const list = classesByName.get(simple) ?? [];
      list.push(sym.key);
      classesByName.set(simple, list);
    }
  }
  for (const file of parse.files) {
    for (const sym of file.symbols) {
      if (sym.kind !== 'class' || !sym.extends) continue;
      for (const base of sym.extends) {
        for (const target of classesByName.get(base) ?? []) {
          if (target !== sym.key) {
            addEdge({ from: sym.key, to: target, kind: 'extends' });
          }
        }
      }
    }
  }

  // fan-in computation
  for (const edge of edges.values()) {
    const target = nodes.get(edge.to);
    if (target) target.fanIn++;
  }

  const cycles = detectCycles(parse.files);
  return { nodes: [...nodes.values()], edges: [...edges.values()], cycles };
}

/** Symbol keys referenced anywhere (used by dead-code detection). */
export function referencedSymbols(built: BuiltGraph): Set<string> {
  const used = new Set<string>();
  for (const edge of built.edges) {
    if (edge.kind === 'calls') {
      used.add(edge.to);
    }
  }
  return used;
}

export { symbolKey, fileKey };
