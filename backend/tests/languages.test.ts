import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { parseSourceDir } from '../src/services/analyzer/parser';

/**
 * Multi-language support (PRD §4.1): TypeScript/JavaScript keep full
 * ts-morph parsing, Python gets best-effort symbols/imports, and everything
 * else is accepted as a file-level node with no symbols or edges.
 * Runs against a real temp directory — no network, no database.
 */

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repoverse-languages-'));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.mkdirSync(path.join(dir, 'pkg'));

  fs.writeFileSync(
    path.join(dir, 'app.py'),
    [
      '"""Module docstring with a fake symbol: def hidden(): pass"""',
      'import os',
      'from . import util',
      'from .util import helper',
      'from ..pkg import thing',
      '',
      'class Greeter:',
      '    def greet(self, name):',
      '        return helper(name)',
      '',
      'def run():',
      '    g = Greeter()',
      '    return g.greet("world")',
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(dir, 'util.py'),
    'def helper(value):\n    return value\n'
  );

  fs.writeFileSync(
    path.join(dir, 'main.go'),
    'package main\n\nfunc main() {}\n'
  );

  // Not source — must never be collected
  fs.writeFileSync(path.join(dir, 'README.md'), '# hello\n');
  fs.writeFileSync(path.join(dir, 'node_modules', 'ignored.py'), 'def nope():\n    pass\n');
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('multi-language parsing', () => {
  it('collects TS/JS, Python and fallback source files only', () => {
    const result = parseSourceDir(dir);
    const paths = result.files.map((f) => f.path).sort();

    expect(paths).toEqual(['app.py', 'main.go', 'util.py']);
    expect(Object.keys(result.fileHashes).sort()).toEqual(paths);
  });

  it('parses Python classes, methods, functions and relative imports', () => {
    const result = parseSourceDir(dir);
    const app = result.files.find((f) => f.path === 'app.py');
    expect(app).toBeDefined();

    expect(app!.imports).toEqual(['util.py']);
    expect(app!.symbols.map((s) => `${s.kind}:${s.name}`)).toEqual([
      'class:Greeter',
      'method:Greeter.greet',
      'function:run',
    ]);
    expect(app!.symbols.find((s) => s.name === 'Greeter')?.exported).toBe(true);
    expect(app!.symbols.find((s) => s.name === 'Greeter.greet')?.line).toBe(8);

    const util = result.files.find((f) => f.path === 'util.py');
    expect(util!.symbols.map((s) => s.name)).toEqual(['helper']);
  });

  it('resolves Python call edges across files', () => {
    const result = parseSourceDir(dir);
    const run = result.files
      .find((f) => f.path === 'app.py')!
      .symbols.find((s) => s.name === 'run');

    expect(run?.callees).toContain('sym:util.py#helper');
    expect(run?.callees).toContain('sym:app.py#Greeter');
  });

  it('represents other languages as file-level nodes only', () => {
    const result = parseSourceDir(dir);
    const go = result.files.find((f) => f.path === 'main.go');
    expect(go).toMatchObject({
      path: 'main.go',
      loc: 3,
      imports: [],
      symbols: [],
      callNames: [],
    });
  });

  it('reuses unchanged Python and fallback files on a diff-aware run', () => {
    const first = parseSourceDir(dir);
    const second = parseSourceDir(dir, { reuse: first.files });

    expect(second.diff).toEqual({
      reusedFiles: 3,
      changedFiles: 0,
      addedFiles: 0,
      deletedFiles: 0,
    });
    const app = second.files.find((f) => f.path === 'app.py');
    expect(app!.imports).toEqual(['util.py']);
    expect(app!.symbols.map((s) => s.name)).toEqual([
      'Greeter',
      'Greeter.greet',
      'run',
    ]);
  });
});
