import { AppError } from '../../utils/appError';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { withAnalysisTimeout } from './timeout';
import { fetchRepoMeta, cloneRepo } from './fetcher';
import { parseSourceDir, ParsedFile } from './parser';
import { buildGraph } from './graphBuilder';
import { scoreFiles, repoHealthScore } from './health';
import { extensionOf } from './ignore';
import { Analysis, AnalysisDocument, AnalysisStatus } from '../../modules/analyses/analysis.model';
import { GraphNode, GraphNodeDocument } from '../../modules/graph/graphNode.model';
import { GraphEdge, GraphEdgeDocument } from '../../modules/graph/graphEdge.model';
import { FileSnapshot } from '../../modules/graph/fileSnapshot.model';
import { Repo, RepoDocument } from '../../modules/repos/repo.model';
import { resolveUserGithubToken } from '../../modules/users/githubToken.service';
import {
  embedAnalysisFiles,
  isEmbeddingsConfigured,
  pruneAnalysisEmbeddings,
} from '../ai/embeddings';
import { publishAnalysisUpdate } from '../../socket';
import { isUserCancelled } from './queue';
import fs from 'fs';

/**
 * Analysis pipeline (PRD §10.1) — Phase 2.
 *
 * fetching → parsing → building_graph → done
 *   fetching      : metadata re-validation + shallow clone (temp workspace)
 *   parsing       : ts-morph symbols / imports / calls
 *   building_graph: nodes/edges persistence, SCC cycles, health scores
 *
 * Repo source lives ONLY in the temp workspace and is deleted in a
 * finally block — nothing outside the derived graph is retained (PRD §10.5).
 */

async function step(
  userId: unknown,
  repoId: unknown,
  analysisId: string,
  patch: Partial<
    Pick<
      AnalysisDocument,
      'status' | 'progress' | 'commitSha' | 'summary' | 'startedAt' | 'error' | 'cycles'
    >
  >
): Promise<void> {
  await Analysis.updateOne({ _id: analysisId }, { $set: patch });
  publishAnalysisUpdate(userId, {
    analysisId,
    repoId: String(repoId),
    status: patch.status ?? 'fetching',
    progress: patch.progress ?? 0,
    ...(patch.error ? { error: patch.error } : {}),
    ...(patch.summary ? { summary: patch.summary } : {}),
  });
}

async function fail(
  userId: unknown,
  repoId: unknown,
  analysisId: string,
  code: string,
  message: string
): Promise<void> {
  const error = { code, message };
  await Analysis.updateOne(
    { _id: analysisId },
    {
      $set: {
        status: 'failed' satisfies AnalysisStatus,
        progress: 100,
        error,
        finishedAt: new Date(),
      },
    }
  );
  publishAnalysisUpdate(userId, {
    analysisId,
    repoId: String(repoId),
    status: 'failed',
    progress: 100,
    error,
  });
}

export async function runAnalysis(analysisId: string): Promise<void> {
  const analysis = await Analysis.findById(analysisId);
  if (!analysis || analysis.status === 'done') return;

  const repo = await Repo.findById(analysis.repoId);
  if (!repo) {
    await fail(analysis.userId, analysis.repoId, analysisId, 'NOT_FOUND', 'Repository record missing');
    return;
  }

  try {
    await withAnalysisTimeout(execute(repo, analysisId));
  } catch (err) {
    if (err instanceof AppError) {
      await fail(analysis.userId, analysis.repoId, analysisId, err.code, err.message);
    } else {
      logger.error(
        'Analysis crashed',
        err instanceof Error ? err : new Error(String(err))
      );
      await fail(
        analysis.userId,
        analysis.repoId,
        analysisId,
        'ANALYSIS_INTERNAL',
        'Analysis failed — see server logs'
      );
    }
  }
}

async function execute(repo: RepoDocument, analysisId: string): Promise<void> {
  const userId = repo.userId;
  const repoId = repo._id;

  // Account deletion cancels this job — never clone or persist on its behalf.
  if (isUserCancelled(userId)) return;

  // 1. Re-validate repo before any work (may have changed/been deleted upstream).
  //    The user's encrypted PAT (when connected) authorizes private repos for
  //    metadata, clone and on-demand source reads.
  await step(userId, repoId, analysisId, {
    status: 'fetching',
    progress: 5,
    startedAt: new Date(),
    error: undefined,
  });
  const token = await resolveUserGithubToken(String(repo.userId));
  const meta = await fetchRepoMeta(repo.githubOwner, repo.githubName, token);

  // 2. Shallow clone into temp workspace
  await step(userId, repoId, analysisId, { status: 'fetching', progress: 20 });
  const cloned = await cloneRepo(meta.owner, meta.name, repo.branch, token);

  try {
    await step(userId, repoId, analysisId, { commitSha: cloned.commitSha, progress: 35 });

    // 3. Parse symbols / imports / calls — diff-aware when a previous done
    //    analysis exists (PRD §4.8): unchanged files are never re-parsed,
    //    and their derived snapshots are carried forward verbatim.
    await step(userId, repoId, analysisId, { status: 'parsing', progress: 50 });

    const previous = await Analysis.findOne({
      repoId: repo._id,
      userId: repo.userId,
      status: 'done',
      isDeleted: false,
      _id: { $ne: analysisId },
    })
      .sort({ finishedAt: -1 })
      .select('_id')
      .lean();

    let reuse: ParsedFile[] | undefined;
    if (previous) {
      const snapshots = await FileSnapshot.find({ analysisId: previous._id }).lean();
      if (snapshots.length > 0) {
        reuse = snapshots.map((s) => ({
          path: s.path,
          hash: s.hash,
          loc: s.loc,
          imports: s.imports,
          symbols: s.symbols.map((sym) => ({
            key: sym.key,
            name: sym.name,
            kind: sym.kind,
            line: sym.line,
            exported: sym.exported,
            callees: [],
            ...(sym.endLine !== undefined ? { endLine: sym.endLine } : {}),
            ...(sym.paramCount !== undefined ? { paramCount: sym.paramCount } : {}),
            ...(sym.complexity !== undefined ? { complexity: sym.complexity } : {}),
            ...(sym.extends && sym.extends.length > 0
              ? { extends: sym.extends }
              : {}),
          })),
          callNames: s.callNames,
        }));
      }
    }

    const parse = parseSourceDir(cloned.dir, reuse ? { reuse } : {});
    if (parse.diff) {
      logger.info(
        `Diff-aware refresh: ${parse.diff.reusedFiles} reused, ${parse.diff.changedFiles} changed, ` +
          `${parse.diff.addedFiles} added, ${parse.diff.deletedFiles} deleted`
      );
    }
    if (parse.files.length === 0) {
      throw new AppError(
        422,
        'REPO_UNSUPPORTED_LANGUAGE',
        'No parseable source files found — supported: TypeScript/JavaScript, Python (best effort), and file-level fallback for other source languages'
      );
    }

    // 4. Build graph + health + cycles
    await step(userId, repoId, analysisId, { status: 'building_graph', progress: 70 });
    const built = buildGraph(parse);
    const healths = scoreFiles(built);

    // 5. Persist nodes + edges (scoped to this analysis + user)
    if (isUserCancelled(userId)) return;
    const nodeDocs: Partial<GraphNodeDocument>[] = built.nodes.map((n) => ({
      analysisId: analysisId as never,
      repoId: repo._id,
      userId: repo.userId,
      key: n.key,
      kind: n.kind,
      path: n.path,
      name: n.name,
      loc: n.loc,
      exported: n.exported,
      fanIn: n.fanIn,
      fanOut: n.fanOut,
      ...(n.endLine !== undefined ? { endLine: n.endLine } : {}),
      ...(n.paramCount !== undefined ? { paramCount: n.paramCount } : {}),
      ...(n.complexity !== undefined ? { complexity: n.complexity } : {}),
    }));
    const edgeDocs: Partial<GraphEdgeDocument>[] = built.edges.map((e) => ({
      analysisId: analysisId as never,
      repoId: repo._id,
      userId: repo.userId,
      from: e.from,
      to: e.to,
      kind: e.kind,
    }));

    await GraphNode.insertMany(nodeDocs, { ordered: false });
    if (edgeDocs.length > 0) {
      await GraphEdge.insertMany(edgeDocs, { ordered: false });
    }

    // 5b. Persist derived snapshots for the NEXT diff-aware refresh — paths,
    //     hashes, imports, symbol summaries and call names; never source.
    await FileSnapshot.insertMany(
      parse.files.map((f) => ({
        analysisId,
        repoId: repo._id,
        userId: repo.userId,
        path: f.path,
        hash: f.hash,
        loc: f.loc,
        imports: f.imports,
        symbols: f.symbols.map((sym) => ({
          key: sym.key,
          name: sym.name,
          kind: sym.kind,
          line: sym.line,
          exported: sym.exported,
          ...(sym.endLine !== undefined ? { endLine: sym.endLine } : {}),
          ...(sym.paramCount !== undefined ? { paramCount: sym.paramCount } : {}),
          ...(sym.complexity !== undefined ? { complexity: sym.complexity } : {}),
          ...(sym.extends && sym.extends.length > 0
            ? { extends: sym.extends }
            : {}),
        })),
        callNames: f.callNames,
      })),
      { ordered: false }
    );

    // 5c. Best-effort semantic index (PRD §10.2) — a provider outage must
    //     never fail an analysis; Smart Search then stays keyword-only.
    let embeddedFiles = 0;
    if (isEmbeddingsConfigured()) {
      await step(userId, repoId, analysisId, { status: 'building_graph', progress: 85 });
      try {
        embeddedFiles = await embedAnalysisFiles({
          analysisId,
          repoId: repo._id,
          userId: repo.userId,
          files: parse.files,
          previousAnalysisId: previous?._id,
        });
        logger.info(`Embedded ${embeddedFiles} file summaries for Smart Search`);
      } catch (err) {
        logger.warn(
          'Embedding generation failed — analysis continues without semantic index',
          err instanceof Error ? err : new Error(String(err))
        );
      }
    }

    // 6. Finalize with summary + cycles
    if (isUserCancelled(userId)) return;
    const langCounts = new Map<string, number>();
    for (const file of parse.files) {
      const ext = extensionOf(file.path);
      langCounts.set(ext, (langCounts.get(ext) ?? 0) + 1);
    }
    const languages = [...langCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ext, count]) => ({ ext, count }));

    const symbolCount = parse.files.reduce((sum, f) => sum + f.symbols.length, 0);
    const summary = {
      fileCount: parse.files.length,
      symbolCount,
      cycleCount: built.cycles.length,
      healthScore: repoHealthScore(healths),
      skippedLarge: parse.skippedFiles,
      truncated: parse.files.length >= env.REPO_MAX_FILES,
      languages,
      ...(parse.diff ? { diff: parse.diff } : {}),
      ...(embeddedFiles > 0 ? { embeddedFiles } : {}),
    };

    const finalUpdate = {
      status: 'done' satisfies AnalysisStatus,
      progress: 100,
      summary,
      cycles: built.cycles,
      finishedAt: new Date(),
    };
    await Analysis.updateOne({ _id: analysisId }, { $set: finalUpdate });
    publishAnalysisUpdate(userId, {
      analysisId,
      repoId: String(repoId),
      status: finalUpdate.status,
      progress: 100,
      summary,
    });

    // Bound snapshot growth: keep this analysis + its predecessor only —
    // enough for one more diff-aware refresh, no unbounded history.
    await FileSnapshot.deleteMany({
      repoId: repo._id,
      analysisId: { $nin: [analysisId, previous?._id].filter((id) => id != null) },
    });

    // Same retention for vectors — keeps the previous analysis' embeddings so
    // the next refresh can reuse unchanged files without provider calls.
    try {
      await pruneAnalysisEmbeddings(repo._id, [analysisId, previous?._id]);
    } catch (pruneErr) {
      logger.warn(
        'Failed to prune old embeddings',
        pruneErr instanceof Error ? pruneErr : new Error(String(pruneErr))
      );
    }
  } finally {
    // Workspace deleted no matter what — repo source is never retained (PRD §10.5)
    try {
      fs.rmSync(cloned.dir, { recursive: true, force: true });
    } catch (cleanupErr) {
      logger.warn(
        'Failed to remove clone workspace',
        cleanupErr instanceof Error ? cleanupErr : new Error(String(cleanupErr))
      );
    }
  }
}
