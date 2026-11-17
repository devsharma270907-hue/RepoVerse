import { Request, Response, NextFunction } from 'express';
import { Repo } from '../repos/repo.model';
import { GraphNode } from '../graph/graphNode.model';
import { assertOwnership } from '../../utils/ownershipCheck';
import { getRepoOrThrow } from '../repos/repos.service';
import { getDoneAnalysisOrThrow } from '../graph/graph.controller';
import { loadBuiltGraph } from '../graph/graphLoader';
import { requireParam } from '../../middleware/validate';
import { scoreFiles, repoHealthScore } from '../../services/analyzer/health';
import { AppError } from '../../utils/appError';
import { SavedView, SavedViewDocument } from './savedView.model';
import { PinnedFinding } from './pinnedFinding.model';

/**
 * Persistent workspace state (PRD Phase 3): saved views, pinned findings and
 * JSON/Markdown reports. Every query is owner-scoped; cross-user access is a
 * 404, never a 403.
 */

function serializeView(view: SavedViewDocument) {
  return {
    id: String(view._id),
    repoId: String(view.repoId),
    name: view.name,
    description: view.description ?? null,
    state: {
      level: view.state.level,
      ...(view.state.searchQuery ? { searchQuery: view.state.searchQuery } : {}),
      ...(view.state.focusNode ? { focusNode: view.state.focusNode } : {}),
      ...(view.state.isolatedNode ? { isolatedNode: view.state.isolatedNode } : {}),
      highlightedNodes: view.state.highlightedNodes ?? [],
      filterKinds: view.state.filterKinds ?? [],
    },
    isPinned: view.isPinned,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

// ── Saved views ─────────────────────────────────────────────────────────

/** GET /api/v1/repos/:id/views */
export async function listViews(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const repo = await getRepoOrThrow(req.user!.id, requireParam(req, 'id'));
    const views = await SavedView.find({
      userId: req.user!.id,
      repoId: repo._id,
      isDeleted: false,
    }).sort({ isPinned: -1, updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: { repoId: String(repo._id), views: views.map(serializeView) },
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/repos/:id/views */
export async function createView(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const repo = await getRepoOrThrow(req.user!.id, requireParam(req, 'id'));
    const view = await SavedView.create({
      userId: req.user!.id,
      repoId: repo._id,
      name: req.body.name,
      ...(req.body.description ? { description: req.body.description } : {}),
      state: req.body.state,
      isPinned: req.body.isPinned ?? false,
    });

    res.status(201).json({
      success: true,
      data: { view: serializeView(view) },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/workspace/views/:id */
export async function getView(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const view = await assertOwnership(
      SavedView,
      requireParam(req, 'id'),
      req.user!.id
    );
    res.status(200).json({ success: true, data: { view: serializeView(view) } });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/workspace/views/:id */
export async function updateView(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const view = await assertOwnership(
      SavedView,
      requireParam(req, 'id'),
      req.user!.id
    );

    if (req.body.name !== undefined) view.name = req.body.name;
    if (req.body.isPinned !== undefined) view.isPinned = req.body.isPinned;
    if (req.body.description !== undefined) {
      if (req.body.description === null || req.body.description === '') {
        view.set('description', undefined);
      } else {
        view.description = req.body.description;
      }
    }
    if (req.body.state) {
      const current = view.get('state') as { toObject(): Record<string, unknown> };
      view.set('state', { ...current.toObject(), ...req.body.state });
    }

    await view.save();
    res.status(200).json({ success: true, data: { view: serializeView(view) } });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/v1/workspace/views/:id — soft delete */
export async function deleteView(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const view = await assertOwnership(
      SavedView,
      requireParam(req, 'id'),
      req.user!.id
    );
    view.isDeleted = true;
    view.deletedAt = new Date();
    await view.save();

    res.status(200).json({
      success: true,
      data: { id: String(view._id), deleted: true },
    });
  } catch (err) {
    next(err);
  }
}

// ── Pinned findings ─────────────────────────────────────────────────────

function serializePin(pin: {
  _id: unknown;
  repoId: unknown;
  analysisId: unknown;
  nodeKey: string;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(pin._id),
    repoId: String(pin.repoId),
    analysisId: String(pin.analysisId),
    nodeKey: pin.nodeKey,
    note: pin.note ?? null,
    createdAt: pin.createdAt,
    updatedAt: pin.updatedAt,
  };
}

/** GET /api/v1/analyses/:id/pins */
export async function listPins(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const analysis = await getDoneAnalysisOrThrow(req);
    const pins = await PinnedFinding.find({
      userId: req.user!.id,
      analysisId: analysis._id,
      isDeleted: false,
    }).sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: {
        analysisId: String(analysis._id),
        pins: pins.map(serializePin),
      },
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/analyses/:id/pins */
export async function createPin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const analysis = await getDoneAnalysisOrThrow(req);
    const nodeKey = String(req.body.nodeKey);

    const node = await GraphNode.exists({ analysisId: analysis._id, key: nodeKey });
    if (!node) {
      throw new AppError(404, 'NODE_NOT_FOUND', 'Node not found in this analysis graph');
    }

    const pin = await PinnedFinding.create({
      userId: req.user!.id,
      repoId: analysis.repoId,
      analysisId: analysis._id,
      nodeKey,
      ...(req.body.note ? { note: req.body.note } : {}),
    });

    res.status(201).json({ success: true, data: { pin: serializePin(pin) } });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/workspace/pins/:id */
export async function updatePin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const pin = await assertOwnership(
      PinnedFinding,
      requireParam(req, 'id'),
      req.user!.id
    );

    if (req.body.note !== undefined) {
      if (req.body.note === null || req.body.note === '') {
        pin.set('note', undefined);
      } else {
        pin.note = req.body.note;
      }
    }
    await pin.save();

    res.status(200).json({ success: true, data: { pin: serializePin(pin) } });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/v1/workspace/pins/:id — soft delete */
export async function deletePin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const pin = await assertOwnership(
      PinnedFinding,
      requireParam(req, 'id'),
      req.user!.id
    );
    pin.isDeleted = true;
    pin.deletedAt = new Date();
    await pin.save();

    res.status(200).json({
      success: true,
      data: { id: String(pin._id), deleted: true },
    });
  } catch (err) {
    next(err);
  }
}

// ── Report export (JSON / Markdown) ─────────────────────────────────────

function markdownReport(input: {
  repo: { owner: string; name: string; url: string; branch: string };
  analysis: {
    id: string;
    commitSha?: string;
    finishedAt?: Date;
    summary?: unknown;
  };
  repoScore: number;
  files: ReturnType<typeof scoreFiles>;
  cycles: Array<{ path: string[]; length: number; severity: string }>;
  pins: Array<{ nodeKey: string; note?: string }>;
}): string {
  const lines: string[] = [];
  lines.push(`# RepoVerse report — ${input.repo.owner}/${input.repo.name}`);
  lines.push('');
  lines.push(`- Repository: ${input.repo.url}`);
  lines.push(`- Branch: ${input.repo.branch}`);
  lines.push(`- Commit: ${input.analysis.commitSha ?? '(unknown)'}`);
  lines.push(`- Analysis: ${input.analysis.id}`);
  if (input.analysis.finishedAt) {
    lines.push(`- Finished: ${new Date(input.analysis.finishedAt).toISOString()}`);
  }
  lines.push(`- Health score: ${input.repoScore}/100`);
  lines.push('');

  const summary = (input.analysis.summary ?? {}) as Record<string, unknown>;
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Files: ${String(summary.fileCount ?? input.files.length)}`);
  lines.push(`- Symbols: ${String(summary.symbolCount ?? 0)}`);
  lines.push(`- Circular dependencies: ${input.cycles.length}`);
  if (typeof summary.embeddedFiles === 'number') {
    lines.push(`- Embedded files: ${summary.embeddedFiles}`);
  }
  lines.push('');

  lines.push('## Circular dependencies');
  lines.push('');
  if (input.cycles.length === 0) {
    lines.push('None detected.');
  } else {
    for (const cycle of input.cycles) {
      lines.push(
        `- ${cycle.path.join(' → ')} (${cycle.length} files, ${cycle.severity} severity)`
      );
    }
  }
  lines.push('');

  lines.push('## Health hotspots');
  lines.push('');
  const hotspots = input.files.slice(0, 15);
  if (hotspots.length === 0) {
    lines.push('No health findings.');
  } else {
    lines.push('| File | Score | Findings |');
    lines.push('| --- | --- | --- |');
    for (const file of hotspots) {
      const findings =
        file.penalties.map((p) => p.message).join('; ') || 'None';
      lines.push(
        `| ${file.path.replace(/\|/g, '\\|')} | ${file.score} | ${findings.replace(/\|/g, '\\|')} |`
      );
    }
  }
  lines.push('');

  lines.push('## Pinned findings');
  lines.push('');
  if (input.pins.length === 0) {
    lines.push('No pinned findings.');
  } else {
    for (const pin of input.pins) {
      lines.push(`- \`${pin.nodeKey}\`${pin.note ? ` — ${pin.note}` : ''}`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('Generated by RepoVerse.');

  return lines.join('\n');
}

/** GET /api/v1/analyses/:id/report?format=json|markdown */
export async function getReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const analysis = await getDoneAnalysisOrThrow(req);
    const format = req.query.format === 'markdown' ? 'markdown' : 'json';

    const [repo, built, pins] = await Promise.all([
      Repo.findById(analysis.repoId),
      loadBuiltGraph(analysis._id),
      PinnedFinding.find({
        userId: req.user!.id,
        analysisId: analysis._id,
        isDeleted: false,
      })
        .select('nodeKey note')
        .lean(),
    ]);

    if (!repo) throw new AppError(404, 'NOT_FOUND', 'Repository record missing');

    const files = scoreFiles(built);
    const repoScore = repoHealthScore(files);
    const cycles = (analysis.cycles ?? []).map((c) => ({
      path: c.path,
      length: c.length,
      severity: c.severity,
    }));

    const repoInfo = {
      owner: repo.githubOwner,
      name: repo.githubName,
      url: repo.url,
      branch: repo.branch,
    };

    if (format === 'markdown') {
      const markdown = markdownReport({
        repo: repoInfo,
        analysis: {
          id: String(analysis._id),
          commitSha: analysis.commitSha,
          finishedAt: analysis.finishedAt,
          summary: analysis.summary,
        },
        repoScore,
        files,
        cycles,
        pins,
      });
      res
        .status(200)
        .type('text/markdown; charset=utf-8')
        .set(
          'Content-Disposition',
          `attachment; filename="repoverse-${String(analysis._id)}.md"`
        )
        .send(markdown);
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        report: {
          generatedAt: new Date().toISOString(),
          repo: repoInfo,
          analysis: {
            id: String(analysis._id),
            commitSha: analysis.commitSha ?? null,
            finishedAt: analysis.finishedAt ?? null,
            summary: analysis.summary ?? null,
          },
          health: { repoScore, files },
          cycles,
          pins: pins.map((pin) => ({
            nodeKey: pin.nodeKey,
            note: pin.note ?? null,
          })),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/** Internal helper reused by account export. */
export async function listUserWorkspace(userId: string) {
  const [views, pins] = await Promise.all([
    SavedView.find({ userId, isDeleted: false }).lean(),
    PinnedFinding.find({ userId, isDeleted: false }).lean(),
  ]);
  return { views, pins };
}
