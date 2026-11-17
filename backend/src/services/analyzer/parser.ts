import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Node, Project, SyntaxKind, SourceFile } from 'ts-morph';
import { env } from '../../config/env';
import {
  IGNORED_DIR_NAMES,
  PYTHON_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
  TS_EXTENSIONS,
  isIgnoredRelPath,
  toPosix,
} from './ignore';

/**
 * Symbol-level source parser (PRD §10.1 step 5) using ts-morph
 * (TypeScript compiler API). Also covers JS/JSX — the compiler handles both.
 *
 * Output contract (consumed by graphBuilder.ts):
 *  - files with loc + resolved internal imports
 *  - symbols (classes, functions, methods, exported arrow consts)
 *  - best-effort call edges between symbols
 *
 * Diff-aware refresh (PRD §4.8): when the caller passes the previous
 * analysis' parsed files, unchanged files (same sha256) are reused verbatim
 * and never handed to ts-morph. Call edges are recomputed from the stored
 * call-name sets over the FULL merged file set, so results are identical to
 * a full parse — the snapshots are derived metadata only, never source.
 */

export type SymbolKind = 'class' | 'function' | 'method';

export interface ParsedSymbol {
  key: string; // `sym:<relPath>#<name>`
  name: string;
  kind: SymbolKind;
  line: number;
  exported: boolean;
  callees: string[]; // symbol keys this symbol calls (best effort)
  // Static complexity metrics (PRD §4.5) — best effort, never executed code
  endLine?: number;
  paramCount?: number;
  complexity?: number; // cyclomatic estimate: 1 + branch points
  extends?: string[]; // class base names (for best-effort `extends` edges)
}

export interface ParsedFile {
  path: string; // rel posix path
  hash: string; // sha256 of the file bytes — the diff-aware refresh key
  loc: number;
  imports: string[]; // resolved internal import targets (rel posix paths)
  symbols: ParsedSymbol[];
  callNames: string[]; // identifiers invoked in this file (call/new expressions)
}

export interface ParseDiff {
  reusedFiles: number; // unchanged content — never re-parsed
  changedFiles: number; // same path, different content — re-parsed
  addedFiles: number; // new path — parsed
  deletedFiles: number; // gone since the previous analysis
}

export interface ParseResult {
  files: ParsedFile[];
  skippedFiles: number; // over size cap
  unresolvedImportCount: number; // external (packages) or unresolvable
  fileHashes: Record<string, string>; // rel path → sha256 (all collected files)
  diff?: ParseDiff; // present only on diff-aware (reuse) runs
}

export function symbolKey(relPath: string, name: string): string {
  return `sym:${toPosix(relPath)}#${name}`;
}

export function fileKey(relPath: string): string {
  return `file:${toPosix(relPath)}`;
}

/** Content hash used to decide whether a file changed between analyses. */
export function hashFile(absPath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

/** Recursive walk with ignore rules + file-size and count caps. */
export function collectSourceFiles(rootDir: string): {
  paths: string[]; // absolute
  relPaths: string[]; // rel posix
  skippedFiles: number;
} {
  const maxFiles = env.REPO_MAX_FILES;
  const maxFileBytes = env.REPO_MAX_FILE_SIZE_KB * 1024;

  const out: string[] = [];
  const relOut: string[] = [];
  let skippedFiles = 0;

  const walk = (dir: string): void => {
    if (out.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir — skip silently
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;

      const abs = path.join(dir, entry.name);
      const rel = toPosix(path.relative(rootDir, abs));

      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isIgnoredRelPath(rel)) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      let size = 0;
      try {
        size = fs.statSync(abs).size;
      } catch {
        continue;
      }
      if (size > maxFileBytes) {
        skippedFiles++;
        continue;
      }
      out.push(abs);
      relOut.push(rel);
    }
  };

  walk(rootDir);
  return { paths: out, relPaths: relOut, skippedFiles };
}

/** Names invoked via call/new expressions in one file (cross-file resolution). */
function collectCallNames(sourceFile: SourceFile): string[] {
  const names = new Set<string>();
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    const name =
      expr.getKind() === SyntaxKind.Identifier
        ? expr.getText()
        : expr.getKind() === SyntaxKind.PropertyAccessExpression
          ? (expr.getLastChild()?.getText() ?? '')
          : '';
    if (name) names.add(name);
  }
  for (const ne of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const name = ne.getExpression().getText();
    if (name) names.add(name);
  }
  return [...names];
}

/**
 * Resolves best-effort `calls` edges over a complete file set.
 * Because it works from each file's stored `callNames`, reused (unparsed)
 * files get edges correct against symbols introduced by changed/new files.
 */
export function applyCallEdges(files: ParsedFile[]): void {
  // Maps every callable name to its defining symbol keys so call/new
  // expressions can be attributed. Ambiguous names link to ALL candidates
  // (over-approximation is safer than missing calls for v1).
  const byName = new Map<string, string[]>();
  for (const file of files) {
    for (const sym of file.symbols) {
      const list = byName.get(sym.name) ?? [];
      list.push(sym.key);
      byName.set(sym.name, list);
    }
  }

  for (const file of files) {
    for (const sym of file.symbols) sym.callees = [];
  }

  for (const file of files) {
    // attribute every called name to ALL symbols of this file
    for (const name of file.callNames) {
      const targets = byName.get(name);
      if (!targets) continue;
      for (const from of file.symbols) {
        for (const to of targets) {
          if (from.key === to) continue;
          if (!from.callees.includes(to)) from.callees.push(to);
        }
      }
    }
  }
}

function isExported(node: { isExported?: () => boolean }): boolean {
  return node.isExported?.() === true;
}

/**
 * Cyclomatic-complexity estimate (PRD §4.5): 1 + decision points. Static
 * only — the analyzed code is never executed.
 */
function countComplexity(node: Node): number {
  let complexity = 1;
  const branches: SyntaxKind[] = [
    SyntaxKind.IfStatement,
    SyntaxKind.ForStatement,
    SyntaxKind.ForInStatement,
    SyntaxKind.ForOfStatement,
    SyntaxKind.WhileStatement,
    SyntaxKind.DoStatement,
    SyntaxKind.CaseClause,
    SyntaxKind.CatchClause,
    SyntaxKind.ConditionalExpression,
  ];
  for (const kind of branches) {
    complexity += node.getDescendantsOfKind(kind).length;
  }
  for (const binary of node.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const op = binary.getOperatorToken().getKind();
    if (
      op === SyntaxKind.AmpersandAmpersandToken ||
      op === SyntaxKind.BarBarToken ||
      op === SyntaxKind.QuestionQuestionToken
    ) {
      complexity++;
    }
  }
  return complexity;
}

const IMPORT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
];

/**
 * Resolves a relative import specifier against the set of files present in
 * this analysis (rel posix paths). Used in BOTH full and diff-aware parses
 * so incremental results are identical by construction.
 *
 * Handles the cases ts-morph/TS would: extensionless (`./b`), explicit
 * (`./b.ts`), NodeNext-style `./b.js` → `b.ts`, and directory indexes.
 */
function resolveInternalImport(
  fromRelPath: string,
  specifier: string,
  currentPaths: Set<string>
): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  const joined = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromRelPath), specifier)
  );
  if (joined.startsWith('..') || path.posix.isAbsolute(joined)) return null;

  const candidates: string[] = [];
  const ext = path.posix.extname(joined);
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
    // NodeNext: an import of `./b.js` may refer to the TS source `b.ts`
    const stem = joined.slice(0, -ext.length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`);
  }
  candidates.push(joined);
  for (const e of IMPORT_EXTENSIONS) candidates.push(`${joined}${e}`);
  for (const e of IMPORT_EXTENSIONS) candidates.push(`${joined}/index${e}`);

  for (const candidate of candidates) {
    if (currentPaths.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Best-effort Python import resolution (PRD §4.1 — Python is v1
 * best-effort). Handles absolute imports, `from x import y`, and relative
 * imports (`from .mod import x`, `from ..pkg import y`) against the files
 * present in this analysis. Anything else is an external package.
 */
function pythonModuleCandidates(target: string): string[] {
  if (!target) return [];
  return [
    `${target}.py`,
    `${target}.pyi`,
    `${target}/__init__.py`,
    `${target}/__init__.pyi`,
  ];
}

function resolvePythonModule(
  target: string,
  currentPaths: Set<string>
): string | null {
  for (const candidate of pythonModuleCandidates(target)) {
    if (currentPaths.has(candidate)) return candidate;
  }
  return null;
}

/** Converts a dotted Python specifier to a repo-relative dotted module path. */
function pythonSpecifierToTarget(
  fromRelPath: string,
  specifier: string
): string | null {
  const match = /^(\.*)(.*)$/.exec(specifier);
  if (!match) return null;
  const dots = match[1]?.length ?? 0;
  const rest = match[2] ?? '';

  let baseParts: string[] = [];
  if (dots > 0) {
    baseParts = path
      .posix.dirname(fromRelPath)
      .split('/')
      .filter((part) => part && part !== '.');
    // One leading dot = current package; each extra dot goes one level up
    for (let i = 1; i < dots; i++) baseParts.pop();
    if (dots > 1 && baseParts.length === 0) return null; // escaped the repo
  }

  const restParts = rest.split('.').filter(Boolean);
  return [...baseParts, ...restParts].join('/');
}

/** Visual indentation width (tabs = 4) — Python metrics are best effort. */
function indentOf(line: string): number {
  return (line.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '    ').length;
}

const PY_KEYWORDS = new Set([
  'if',
  'elif',
  'else',
  'for',
  'while',
  'try',
  'except',
  'finally',
  'with',
  'return',
  'yield',
  'await',
  'lambda',
  'def',
  'class',
  'import',
  'from',
  'as',
  'raise',
  'assert',
  'del',
  'pass',
  'break',
  'continue',
  'global',
  'nonlocal',
  'and',
  'or',
  'not',
  'in',
  'is',
  'match',
  'case',
]);

/** Calls (`foo(`, `obj.foo(`) in Python source — best effort. */
function collectPythonCallNames(source: string): string[] {
  const names = new Set<string>();
  // Lookbehinds keep `def foo(` / `class Foo(` declarations out of call
  // edges and prevent matching suffixes of identifiers (`reet` from `greet`).
  const re =
    /(?<!\w)(?<!\bdef\s+)(?<!\bclass\s+)(?:\.\s*)?([A-Za-z_]\w*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const name = match[1];
    if (!name || PY_KEYWORDS.has(name)) continue;
    names.add(name);
  }
  return [...names];
}

interface PythonScope {
  indent: number;
  name: string;
  kind: 'class' | 'function';
  exported: boolean;
}

/**
 * Python parser (best effort): top-level functions/classes, methods,
 * relative + absolute imports and call names. Line-based — deliberately
 * forgiving; a malformed Python file still yields a valid file node.
 */
function parsePythonFile(
  absPath: string,
  relPath: string,
  hash: string,
  currentPaths: Set<string>
): ParsedFile {
  const content = fs.readFileSync(absPath, 'utf8');
  const rawLines = content.split(/\r?\n/);
  const imports = new Set<string>();
  const symbols: ParsedSymbol[] = [];
  const scopes: PythonScope[] = [];

  let inTriple: '"""' | "'''" | null = null;

  for (let index = 0; index < rawLines.length; index++) {
    const rawLine = rawLines[index] ?? '';
    const lineNumber = index + 1;

    // Toggle over triple-quoted strings so docstrings never create symbols.
    // Count parity handles both `"""doc"""` (open+close on one line) and
    // multi-line blocks.
    for (const quote of ['"""', "'''"] as const) {
      const count = rawLine.split(quote).length - 1;
      if (count > 0 && count % 2 === 1) {
        if (inTriple === quote) inTriple = null;
        else if (inTriple === null) inTriple = quote;
      }
    }
    if (inTriple) continue;

    const line = rawLine.split('#')[0] ?? '';
    if (!line.trim()) continue;

    const indent = (line.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '    ').length;

    // ── imports ───────────────────────────────────────────────────────
    const importMatch = /^\s*import\s+(.+)$/.exec(line);
    if (importMatch) {
      for (const part of (importMatch[1] ?? '').split(',')) {
        const spec = part.trim().split(/\s+as\s+/)[0]?.trim() ?? '';
        if (!spec) continue;
        const target = pythonSpecifierToTarget(relPath, spec);
        const resolved = target ? resolvePythonModule(target, currentPaths) : null;
        if (resolved && resolved !== relPath) imports.add(resolved);
      }
      continue;
    }

    const fromMatch = /^\s*from\s+([.\w]+)\s+import\s+(.+)$/.exec(line);
    if (fromMatch) {
      const spec = fromMatch[1] ?? '';
      const baseTarget = pythonSpecifierToTarget(relPath, spec);
      const baseResolved = baseTarget
        ? resolvePythonModule(baseTarget, currentPaths)
        : null;
      if (baseResolved && baseResolved !== relPath) imports.add(baseResolved);

      const names = (fromMatch[2] ?? '')
        .replace(/[()]/g, '')
        .split(',');
      for (const part of names) {
        const name = part.trim().split(/\s+as\s+/)[0]?.trim() ?? '';
        if (!name || name === '*') continue;
        const childTarget = baseTarget ? `${baseTarget}/${name}` : name;
        const childResolved = resolvePythonModule(childTarget, currentPaths);
        if (childResolved && childResolved !== relPath) imports.add(childResolved);
      }
      continue;
    }

    // ── symbols ───────────────────────────────────────────────────────
    const defMatch = /^(async\s+def|def)\s+([A-Za-z_]\w*)/.exec(line.trim());
    const classMatch = /^class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*:/.exec(
      line.trim()
    );
    if (!defMatch && !classMatch) continue;

    while (scopes.length > 0 && (scopes[scopes.length - 1]?.indent ?? -1) >= indent) {
      scopes.pop();
    }

    const parent = scopes[scopes.length - 1];
    const name = defMatch ? (defMatch[2] ?? '') : (classMatch?.[1] ?? '');
    if (!name) continue;

    const isClass = Boolean(classMatch);
    const qualifiedName =
      scopes.length > 0
        ? `${scopes.map((scope) => scope.name).join('.')}.${name}`
        : name;
    const exported =
      scopes.length === 0 ? !name.startsWith('_') : parent?.exported === true;

    const kind: SymbolKind = isClass
      ? 'class'
      : parent?.kind === 'class'
        ? 'method'
        : 'function';

    const bases = isClass
      ? (classMatch?.[2] ?? '')
          .split(',')
          .map((base) => base.trim().split(/[.\[]/)[0]?.trim() ?? '')
          .filter((base) => Boolean(base) && base !== 'object' && !base.includes('='))
      : [];

    symbols.push({
      key: symbolKey(relPath, qualifiedName),
      name: qualifiedName,
      kind,
      line: lineNumber,
      exported,
      callees: [],
      ...(bases.length > 0 ? { extends: bases } : {}),
    });

    scopes.push({ indent, name, kind: isClass ? 'class' : 'function', exported });
  }

  // ── best-effort complexity metrics (PRD §4.5) ────────────────────────
  for (const sym of symbols) {
    const startIdx = sym.line - 1;
    const startIndent = indentOf(rawLines[startIdx] ?? '');
    let endLine = rawLines.length;
    for (let i = startIdx + 1; i < rawLines.length; i++) {
      const candidate = rawLines[i] ?? '';
      if (!candidate.trim()) continue;
      if (indentOf(candidate) <= startIndent) {
        endLine = i; // 0-based index == 1-based count of preceding lines
        break;
      }
    }
    sym.endLine = endLine;

    if (sym.kind === 'class') continue;

    // Signature may span a few lines — join a bounded window to read params
    const head = rawLines
      .slice(startIdx, Math.min(startIdx + 6, endLine))
      .join(' ');
    const sig = /(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(([^)]*)\)/.exec(head);
    sym.paramCount = sig
      ? sig[1]!
          .split(',')
          .map((p) => p.trim())
          .filter(
            (p) =>
              p.length > 0 &&
              p !== 'self' &&
              p !== 'cls' &&
              p !== '/' &&
              p !== '*' &&
              !p.startsWith('*')
          ).length
      : 0;

    const body = rawLines
      .slice(startIdx, endLine)
      .join('\n')
      .replace(/"""[\s\S]*?"""/g, '')
      .replace(/'''[\s\S]*?'''/g, '');
    const branches = body.match(/\b(if|elif|for|while|except|and|or|case)\b/g);
    sym.complexity = 1 + (branches?.length ?? 0);
  }

  const loc =
    content.length === 0
      ? 0
      : content.replace(/\r?\n$/, '').split(/\r?\n/).length;

  return {
    path: relPath,
    hash,
    loc,
    imports: [...imports],
    symbols,
    callNames: collectPythonCallNames(content),
  };
}

/**
 * Framework-agnostic fallback: file node with LOC only — no symbols, no
 * import edges (PRD §4.1 "file-level graph only" for other languages).
 */
function parseFallbackFile(
  absPath: string,
  relPath: string,
  hash: string
): ParsedFile {
  let content = '';
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch {
    content = '';
  }
  const loc =
    content.length === 0
      ? 0
      : content.replace(/\r?\n$/, '').split(/\r?\n/).length;
  return { path: relPath, hash, loc, imports: [], symbols: [], callNames: [] };
}

/** Extracts imports/symbols for one ts-morph source file. */
function parseSingleFile(
  sourceFile: SourceFile,
  relPath: string,
  hash: string,
  currentPaths: Set<string>
): { file: ParsedFile; unresolvedImports: number } {
  // ── imports (internal, resolved) ────────────────────────────────────
  const imports = new Set<string>();
  let unresolvedImports = 0;
  const specs = [
    ...sourceFile.getImportDeclarations(),
    ...sourceFile.getExportDeclarations().filter((d) => d.getModuleSpecifier() !== undefined),
  ];
  for (const decl of specs) {
    const targetRel = resolveInternalImport(
      relPath,
      decl.getModuleSpecifierValue() ?? '',
      currentPaths
    );
    if (!targetRel) {
      unresolvedImports++; // external package or unresolvable — fine
      continue;
    }
    if (targetRel !== relPath) imports.add(targetRel);
  }

  // ── symbols ─────────────────────────────────────────────────────────
  const symbols: ParsedSymbol[] = [];

  for (const fn of sourceFile.getFunctions()) {
    symbols.push({
      key: symbolKey(relPath, fn.getName() ?? '<anonymous>'),
      name: fn.getName() ?? '<anonymous>',
      kind: 'function',
      line: fn.getStartLineNumber(),
      exported: isExported(fn),
      callees: [],
      endLine: fn.getEndLineNumber(),
      paramCount: fn.getParameters().length,
      complexity: countComplexity(fn),
    });
  }

  // exported arrow-function consts: export const foo = () => {...}
  for (const stmt of sourceFile.getVariableStatements()) {
    if (!isExported(stmt)) continue;
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      const isFnLike =
        init.getKindName() === 'ArrowFunction' ||
        init.getKindName() === 'FunctionExpression';
      if (!isFnLike) continue;
      const name = decl.getName();
      const fnInit = init as unknown as {
        getParameters(): Node[];
      };
      symbols.push({
        key: symbolKey(relPath, name),
        name,
        kind: 'function',
        line: decl.getStartLineNumber(),
        exported: true,
        callees: [],
        endLine: init.getEndLineNumber(),
        paramCount: fnInit.getParameters().length,
        complexity: countComplexity(init),
      });
    }
  }

  for (const cls of sourceFile.getClasses()) {
    const className = cls.getName() ?? '<anonymous>';
    const heritage = cls.getExtends()?.getExpression().getText();
    const baseName = heritage ? heritage.split('.').pop()?.replace(/<.*$/, '') : '';
    symbols.push({
      key: symbolKey(relPath, className),
      name: className,
      kind: 'class',
      line: cls.getStartLineNumber(),
      exported: isExported(cls),
      callees: [],
      endLine: cls.getEndLineNumber(),
      ...(baseName ? { extends: [baseName] } : {}),
    });
    for (const method of cls.getMethods()) {
      const mName = method.getName();
      if (mName.startsWith('#')) continue; // private-name methods skip
      symbols.push({
        key: symbolKey(relPath, `${className}.${mName}`),
        name: `${className}.${mName}`,
        kind: 'method',
        line: method.getStartLineNumber(),
        exported: isExported(cls), // method reachable if its class is
        callees: [],
        endLine: method.getEndLineNumber(),
        paramCount: method.getParameters().length,
        complexity: countComplexity(method),
      });
    }
  }

  return {
    file: {
      path: relPath,
      hash,
      loc: sourceFile.getEndLineNumber(),
      imports: [...imports],
      symbols,
      callNames: collectCallNames(sourceFile),
    },
    unresolvedImports,
  };
}

/**
 * Parses a source directory. Pass `reuse` with the previous analysis' files
 * to enable diff-aware parsing (PRD §4.8): only changed/added files reach
 * ts-morph; unchanged files are carried over from their snapshots.
 */
export function parseSourceDir(
  rootDir: string,
  options: { reuse?: ParsedFile[] } = {}
): ParseResult {
  const { paths, relPaths, skippedFiles } = collectSourceFiles(rootDir);
  const currentPaths = new Set(relPaths);

  const fileHashes: Record<string, string> = {};
  for (let i = 0; i < paths.length; i++) {
    const rel = relPaths[i];
    const abs = paths[i];
    if (rel === undefined || abs === undefined) continue;
    fileHashes[rel] = hashFile(abs);
  }

  // ── diff partition: hash-compare against the previous analysis ──────
  const prevByPath = new Map((options.reuse ?? []).map((f) => [f.path, f]));
  const reusable: ParsedFile[] = [];
  const addPaths: string[] = [];
  const addRels: string[] = [];
  const diff: ParseDiff | undefined = options.reuse
    ? { reusedFiles: 0, changedFiles: 0, addedFiles: 0, deletedFiles: 0 }
    : undefined;

  for (let i = 0; i < paths.length; i++) {
    const rel = relPaths[i];
    const abs = paths[i];
    if (rel === undefined || abs === undefined) continue;
    const prev = prevByPath.get(rel);
    if (prev && prev.hash === fileHashes[rel]) {
      diff!.reusedFiles++;
      // Keep only imports that still exist — identical to a full parse,
      // where a specifier pointing at a deleted file no longer resolves.
      reusable.push({ ...prev, imports: prev.imports.filter((p) => currentPaths.has(p)) });
    } else {
      if (diff) {
        if (prev) diff.changedFiles++;
        else diff.addedFiles++;
      }
      addPaths.push(abs);
      addRels.push(rel);
    }
  }

  if (diff) {
    for (const prevPath of prevByPath.keys()) {
      if (!currentPaths.has(prevPath)) diff.deletedFiles++;
    }
  }

  // Partition newly parsed files by language: ts-morph only sees TS/JS.
  const tsAbsPaths: string[] = [];
  const tsRelPaths: string[] = [];
  const pythonFiles: Array<{ abs: string; rel: string }> = [];
  const fallbackFiles: Array<{ abs: string; rel: string }> = [];
  for (let i = 0; i < addPaths.length; i++) {
    const abs = addPaths[i];
    const rel = addRels[i];
    if (abs === undefined || rel === undefined) continue;
    const ext = path.extname(rel).toLowerCase();
    if (TS_EXTENSIONS.has(ext)) {
      tsAbsPaths.push(abs);
      tsRelPaths.push(rel);
    } else if (PYTHON_EXTENSIONS.has(ext)) {
      pythonFiles.push({ abs, rel });
    } else {
      fallbackFiles.push({ abs, rel });
    }
  }

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: false,
  });
  if (tsAbsPaths.length > 0) project.addSourceFilesAtPaths(tsAbsPaths);

  const parsedRelByFile = new Map<SourceFile, string>();
  for (const [i, absPath] of tsAbsPaths.entries()) {
    const rel = tsRelPaths[i];
    if (rel === undefined) continue;
    const sf = project.getSourceFile(absPath);
    if (sf) parsedRelByFile.set(sf, rel);
  }

  let unresolvedImportCount = 0;
  const parsedFiles: ParsedFile[] = [...reusable];
  for (const sourceFile of project.getSourceFiles()) {
    const relPath = parsedRelByFile.get(sourceFile);
    if (!relPath) continue;
    const parsed = parseSingleFile(
      sourceFile,
      relPath,
      fileHashes[relPath] ?? '',
      currentPaths
    );
    unresolvedImportCount += parsed.unresolvedImports;
    parsedFiles.push(parsed.file);
  }

  for (const { abs, rel } of pythonFiles) {
    parsedFiles.push(parsePythonFile(abs, rel, fileHashes[rel] ?? '', currentPaths));
  }
  for (const { abs, rel } of fallbackFiles) {
    parsedFiles.push(parseFallbackFile(abs, rel, fileHashes[rel] ?? ''));
  }

  applyCallEdges(parsedFiles);
  parsedFiles.sort((a, b) => a.path.localeCompare(b.path));

  return {
    files: parsedFiles,
    skippedFiles,
    unresolvedImportCount,
    fileHashes,
    ...(diff ? { diff } : {}),
  };
}
