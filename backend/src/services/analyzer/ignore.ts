/**
 * Shared path/filter rules for repo ingestion + parsing (PRD §10.1 step 4).
 * Everything here operates on RELATIVE POSIX paths only.
 */

export const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  'target',
  '.gradle',
  'vendor',
  '.idea',
  '.vscode',
]);

export const IGNORED_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
]);

/** TypeScript/JavaScript — full ts-morph symbol-level parsing. */
export const TS_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

/** Python — best-effort regex parsing (PRD §4.1 v1 language support). */
export const PYTHON_EXTENSIONS = new Set(['.py', '.pyw', '.pyi']);

/**
 * Everything else we still accept — file-level graph only (no symbols or
 * import edges), per the PRD framework-agnostic fallback. Binaries, assets
 * and lockfiles never reach this list.
 */
export const FALLBACK_SOURCE_EXTENSIONS = new Set([
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.rb',
  '.php',
  '.cs',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.cxx',
  '.hpp',
  '.hh',
  '.swift',
  '.m',
  '.mm',
  '.scala',
  '.dart',
  '.lua',
  '.r',
  '.pl',
  '.pm',
  '.ex',
  '.exs',
  '.erl',
  '.hrl',
  '.clj',
  '.cljs',
  '.fs',
  '.fsx',
  '.vb',
  '.zig',
  '.sol',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.vue',
  '.svelte',
  '.astro',
  '.proto',
  '.graphql',
  '.gql',
  '.tf',
]);

/** Every extension the ingestion walker may collect. */
export const SUPPORTED_EXTENSIONS = new Set([
  ...TS_EXTENSIONS,
  ...PYTHON_EXTENSIONS,
  ...FALLBACK_SOURCE_EXTENSIONS,
]);

export function isIgnoredRelPath(relPath: string): boolean {
  const posix = relPath.replace(/\\/g, '/');
  const segments = posix.split('/');
  for (const segment of segments.slice(0, -1)) {
    if (IGNORED_DIR_NAMES.has(segment)) return true;
  }
  const base = segments[segments.length - 1] ?? '';
  if (IGNORED_FILES.has(base)) return true;
  return false;
}

export function extensionOf(relPath: string): string {
  const base = relPath.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return 'noext';
  return base.slice(dot + 1).toLowerCase();
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}
