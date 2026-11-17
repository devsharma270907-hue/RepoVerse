import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { parseSourceDir } from '../src/services/analyzer/parser';
import { BuiltGraph, buildGraph } from '../src/services/analyzer/graphBuilder';
import { scoreFiles, repoHealthScore } from '../src/services/analyzer/health';

/**
 * Unit tests for the Phase-2 analyzer, run against the committed fixture
 * project (tests/fixtures/sample-project):
 *
 *   index.ts → c.ts → a.ts ⇄ b.ts → util.ts      (a⇄b is an import cycle)
 *   orphan.ts — imported by nothing (dead code)
 *
 * Expected numbers are derived by hand and asserted below.
 */
const fixtureDir = fileURLToPath(new URL('./fixtures/sample-project', import.meta.url));

const parse = parseSourceDir(fixtureDir);
const built = buildGraph(parse);
const healths = scoreFiles(built);

describe('parser', () => {
  it('collects all 6 supported source files', () => {
    expect(parse.files).toHaveLength(6);
    const paths = parse.files.map((f) => f.path).sort();
    expect(paths).toEqual([
      'a.ts',
      'b.ts',
      'c.ts',
      'index.ts',
      'orphan.ts',
      'util.ts',
    ]);
  });

  it('resolves internal imports to relative posix paths', () => {
    const a = parse.files.find((f) => f.path === 'a.ts')!;
    expect(a.imports).toEqual(['b.ts']);

    const b = parse.files.find((f) => f.path === 'b.ts')!;
    expect(b.imports.sort()).toEqual(['a.ts', 'util.ts']);

    const index = parse.files.find((f) => f.path === 'index.ts')!;
    expect(index.imports).toEqual(['c.ts']);
  });

  it('extracts function symbols with keys and lines', () => {
    const index = parse.files.find((f) => f.path === 'index.ts')!;
    expect(index.symbols).toHaveLength(1);
    expect(index.symbols[0]).toMatchObject({
      key: 'sym:index.ts#main',
      name: 'main',
      kind: 'function',
      exported: true,
    });
    expect(index.symbols[0].line).toBeGreaterThan(0);
  });

  it('records static complexity, parameter count and body span', () => {
    const main = parse.files.find((f) => f.path === 'index.ts')!.symbols[0]!;
    // `export function main(): string { return c(); }` → one branch-free line
    expect(main.complexity).toBe(1);
    expect(main.paramCount).toBe(0);
    expect(main.endLine).toBe(5);
  });

  it('resolves best-effort call edges between symbols', () => {
    const c = parse.files.find((f) => f.path === 'c.ts')!;
    expect(c.symbols[0].callees).toContain('sym:a.ts#a');

    const b = parse.files.find((f) => f.path === 'b.ts')!;
    expect(b.symbols[0].callees).toContain('sym:util.ts#helper');
  });
});

describe('graph builder', () => {
  it('creates a node for every file and symbol', () => {
    const fileNodes = built.nodes.filter((n) => n.kind === 'file');
    const symNodes = built.nodes.filter((n) => n.kind !== 'file');
    expect(fileNodes).toHaveLength(6);
    expect(symNodes).toHaveLength(6);
  });

  it('emits defines, imports and calls edges', () => {
    const kinds = new Set(built.edges.map((e) => e.kind));
    expect(kinds).toEqual(new Set(['defines', 'imports', 'calls']));

    // 6 defines + 5 imports (index→c, a→b, b→a, b→util, c→a) + 4 calls
    expect(built.edges.filter((e) => e.kind === 'defines')).toHaveLength(6);
    expect(built.edges.filter((e) => e.kind === 'imports')).toHaveLength(5);
    expect(built.edges.filter((e) => e.kind === 'calls')).toHaveLength(4);
  });

  it('computes fan-in per file', () => {
    const fanIn = (path: string): number =>
      built.nodes.find((n) => n.kind === 'file' && n.path === path)!.fanIn;

    expect(fanIn('a.ts')).toBe(2); // imported by b and c
    expect(fanIn('b.ts')).toBe(1);
    expect(fanIn('orphan.ts')).toBe(0);
  });

  it('detects exactly one import cycle (a.ts ⇄ b.ts)', () => {
    expect(built.cycles).toHaveLength(1);
    const cycle = built.cycles[0];
    expect(cycle.length).toBe(2);
    expect(cycle.severity).toBe('low');
    expect(cycle.path).toEqual(expect.arrayContaining(['a.ts', 'b.ts']));
  });
});

describe('health score', () => {
  it('flags the orphan file as dead code and nothing else', () => {
    const orphan = healths.find((h) => h.path === 'orphan.ts')!;
    expect(orphan.score).toBe(85); // 100 − 15 DEAD_CODE
    expect(orphan.penalties.map((p) => p.code)).toEqual(['DEAD_CODE']);
    expect(orphan.metrics.deadCodeCandidate).toBe(true);

    const clean = healths.filter((h) => h.path !== 'orphan.ts');
    for (const h of clean) {
      expect(h.score).toBe(100);
      expect(h.penalties).toHaveLength(0);
    }
  });

  it('does not flag entrypoints as dead code', () => {
    const index = healths.find((h) => h.path === 'index.ts')!;
    expect(index.metrics.deadCodeCandidate).toBe(false);
  });

  it('computes the repo score as the rounded file average', () => {
    // (5 × 100 + 85) / 6 = 97.5 → 98
    expect(repoHealthScore(healths)).toBe(98);
  });
});

describe('class inheritance (extends edges)', () => {
  it('links TypeScript and Python subclasses to their base classes', () => {
    const classDir = fileURLToPath(new URL('./fixtures/class-project', import.meta.url));
    const parsed = parseSourceDir(classDir);
    const graph = buildGraph(parsed);

    const extendsEdges = graph.edges.filter((e) => e.kind === 'extends');
    expect(extendsEdges).toContainEqual({
      from: 'sym:child.ts#Child',
      to: 'sym:base.ts#Base',
      kind: 'extends',
    });
    expect(extendsEdges).toContainEqual({
      from: 'sym:child.py#Child',
      to: 'sym:base.py#Base',
      kind: 'extends',
    });
  });
});

describe('symbol-level health scoring', () => {
  it('penalizes complex, long and parameter-heavy symbols with locations', () => {
    const graph: BuiltGraph = {
      nodes: [
        {
          key: 'file:big.ts',
          kind: 'file',
          path: 'big.ts',
          loc: 120,
          fanIn: 1,
          fanOut: 0,
        },
        {
          key: 'sym:big.ts#messy',
          kind: 'function',
          path: 'big.ts',
          name: 'messy',
          loc: 2,
          exported: true,
          fanIn: 0,
          fanOut: 0,
          endLine: 90,
          paramCount: 7,
          complexity: 22,
        },
      ],
      edges: [],
      cycles: [],
    };

    const [file] = scoreFiles(graph);
    const codes = file.penalties.map((p) => p.code);
    expect(codes).toEqual(
      expect.arrayContaining(['HIGH_COMPLEXITY', 'LONG_FUNCTION', 'TOO_MANY_PARAMS'])
    );
    expect(file.metrics.maxComplexity).toBe(22);
    expect(file.metrics.symbolCount).toBe(1);

    const complexity = file.penalties.find((p) => p.code === 'HIGH_COMPLEXITY')!;
    expect(complexity.symbol).toBe('messy');
    expect(complexity.line).toBe(2);
  });

  it('flags unused private helpers but not exported symbols', () => {
    const graph: BuiltGraph = {
      nodes: [
        {
          key: 'file:small.ts',
          kind: 'file',
          path: 'small.ts',
          loc: 20,
          fanIn: 1,
          fanOut: 1,
        },
        {
          key: 'sym:small.ts#privateHelper',
          kind: 'function',
          path: 'small.ts',
          name: 'privateHelper',
          loc: 3,
          exported: false,
          fanIn: 0,
          fanOut: 0,
        },
        {
          key: 'sym:small.ts#publicApi',
          kind: 'function',
          path: 'small.ts',
          name: 'publicApi',
          loc: 8,
          exported: true,
          fanIn: 0,
          fanOut: 0,
        },
      ],
      edges: [],
      cycles: [],
    };

    const [file] = scoreFiles(graph);
    const dead = file.penalties.filter((p) => p.code === 'DEAD_SYMBOL');
    expect(dead).toHaveLength(1);
    expect(dead[0].symbol).toBe('privateHelper');
    expect(file.metrics.deadSymbols).toBe(1);
  });
});
