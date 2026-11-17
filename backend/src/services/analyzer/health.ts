import { BuiltGraph, GraphNodeData, isEntryFile } from './graphBuilder';

/**
 * Code Health Score (PRD §4.5) — transparent per-file scoring.
 * Every deduction is a listed, located finding; nothing is a black box.
 *
 * Phase-2 heuristics (static, no execution):
 *  - SIZE_HOTSPOT      — very large file
 *  - HIGH_COUPLING     — too many outgoing dependencies
 *  - GOD_FILE          — high fan-in (everything depends on it)
 *  - DEAD_CODE         — orphan file: nothing imports it, not an entrypoint
 *  - HIGH_COMPLEXITY   — cyclomatic estimate above threshold
 *  - LONG_FUNCTION     — function body spans too many lines
 *  - TOO_MANY_PARAMS   — function signature is hard to call safely
 *  - DEAD_SYMBOL       — non-exported function/method with no call sites
 *
 * Findings carry `line`/`symbol` so the UI can deep-link to the map (PRD §4.5).
 */

export interface HealthPenalty {
  code: string;
  message: string;
  line?: number;
  symbol?: string;
}

export interface FileHealth {
  path: string;
  score: number; // 0–100
  penalties: HealthPenalty[];
  metrics: {
    loc: number;
    fanIn: number;
    fanOut: number;
    deadCodeCandidate: boolean;
    symbolCount: number;
    maxComplexity: number;
    avgComplexity: number;
    deadSymbols: number;
    // Martin instability: 0 = stable (heavily depended on), 1 = unstable
    instability: number;
  };
}

const COMPLEXITY_HIGH = 15;
const COMPLEXITY_MEDIUM = 10;
const LONG_FUNCTION = 60;
const VERY_LONG_FUNCTION = 120;
const MAX_PARAMS = 5;
const MAX_DEAD_SYMBOL_PENALTIES = 3;

const clamp = (n: number, min: number, max: number): number =>
  Math.min(Math.max(n, min), max);

export function scoreFiles(built: BuiltGraph): FileHealth[] {
  const fileNodes = built.nodes.filter((n) => n.kind === 'file') as Array<
    GraphNodeData & { path: string; loc?: number }
  >;

  // Symbol-level inputs for complexity + dead-symbol findings
  const symbolsByPath = new Map<string, GraphNodeData[]>();
  for (const node of built.nodes) {
    if (node.kind === 'file' || node.kind === 'repo' || !node.path) continue;
    const list = symbolsByPath.get(node.path) ?? [];
    list.push(node);
    symbolsByPath.set(node.path, list);
  }

  const incomingCalls = new Map<string, number>();
  for (const edge of built.edges) {
    if (edge.kind !== 'calls') continue;
    incomingCalls.set(edge.to, (incomingCalls.get(edge.to) ?? 0) + 1);
  }

  return fileNodes
    .map((node) => {
      const penalties: HealthPenalty[] = [];
      let weighted = 0;
      const penal = (
        code: string,
        message: string,
        weight: number,
        extra: { line?: number; symbol?: string } = {}
      ): void => {
        penalties.push({ code, message, ...extra });
        weighted += weight;
      };

      const loc = node.loc ?? 0;
      const fanIn = node.fanIn;
      const fanOut = node.fanOut;

      if (loc > 400) {
        penal('SIZE_HOTSPOT', `${loc} lines — consider splitting`, 20);
      } else if (loc > 200) {
        penal('SIZE_HOTSPOT', `${loc} lines — on the large side`, 10);
      }

      if (fanOut > 15) {
        penal('HIGH_COUPLING', `depends on ${fanOut} other files`, 15);
      } else if (fanOut > 8) {
        penal('HIGH_COUPLING', `depends on ${fanOut} other files`, 8);
      }

      if (fanIn > 10) {
        penal(
          'GOD_FILE',
          `${fanIn} files depend on it — changes here are risky`,
          10
        );
      }

      const deadCodeCandidate = fanIn === 0 && !isEntryFile(node.path);
      if (deadCodeCandidate) {
        penal(
          'DEAD_CODE',
          'Nothing imports this file (and it is not an entrypoint)',
          15
        );
      }

      // ── symbol-level findings ───────────────────────────────────────
      const symbols = symbolsByPath.get(node.path) ?? [];
      let deadSymbols = 0;
      let maxComplexity = 0;
      let complexitySum = 0;

      for (const sym of symbols) {
        const line = sym.loc ?? undefined;
        const name = sym.name;
        if (sym.complexity !== undefined) {
          maxComplexity = Math.max(maxComplexity, sym.complexity);
          complexitySum += sym.complexity;
          if (sym.complexity > COMPLEXITY_HIGH) {
            penal(
              'HIGH_COMPLEXITY',
              `${name ?? 'symbol'} has cyclomatic complexity ${sym.complexity} — consider simplifying`,
              10,
              { line, symbol: name }
            );
          } else if (sym.complexity > COMPLEXITY_MEDIUM) {
            penal(
              'HIGH_COMPLEXITY',
              `${name ?? 'symbol'} has cyclomatic complexity ${sym.complexity}`,
              5,
              { line, symbol: name }
            );
          }
        }

        if (sym.loc !== undefined && sym.endLine !== undefined) {
          const span = sym.endLine - sym.loc + 1;
          if (span > VERY_LONG_FUNCTION) {
            penal(
              'LONG_FUNCTION',
              `${name ?? 'symbol'} spans ${span} lines — consider splitting`,
              12,
              { line, symbol: name }
            );
          } else if (span > LONG_FUNCTION) {
            penal(
              'LONG_FUNCTION',
              `${name ?? 'symbol'} spans ${span} lines`,
              8,
              { line, symbol: name }
            );
          }
        }

        if ((sym.paramCount ?? 0) > MAX_PARAMS) {
          penal(
            'TOO_MANY_PARAMS',
            `${name ?? 'symbol'} takes ${sym.paramCount} parameters`,
            5,
            { line, symbol: name }
          );
        }

        // A non-exported function/method with no incoming call edge is an
        // unused private helper — a much safer signal than "exported but not
        // called internally" (which is normal for public APIs).
        if (
          sym.kind !== 'class' &&
          sym.exported === false &&
          (incomingCalls.get(sym.key) ?? 0) === 0
        ) {
          deadSymbols++;
          penal(
            'DEAD_SYMBOL',
            `Private ${sym.kind} ${name ?? ''} is never called`.trim(),
            deadSymbols <= MAX_DEAD_SYMBOL_PENALTIES ? 3 : 0,
            { line, symbol: name }
          );
        }
      }

      return {
        path: node.path,
        score: clamp(100 - weighted, 5, 100),
        penalties,
        metrics: {
          loc,
          fanIn,
          fanOut,
          deadCodeCandidate,
          symbolCount: symbols.length,
          maxComplexity,
          avgComplexity:
            symbols.length === 0
              ? 0
              : Math.round((complexitySum / symbols.length) * 10) / 10,
          deadSymbols,
          instability:
            fanIn + fanOut === 0
              ? 0
              : Math.round((fanOut / (fanIn + fanOut)) * 100) / 100,
        },
      };
    })
    .sort((a, b) => a.score - b.score);
}

export function repoHealthScore(healths: FileHealth[]): number {
  if (healths.length === 0) return 100;
  const avg = healths.reduce((sum, h) => sum + h.score, 0) / healths.length;
  return Math.round(avg);
}
