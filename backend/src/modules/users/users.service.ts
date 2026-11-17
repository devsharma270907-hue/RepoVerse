import { notFound } from '../../utils/appError';
import { User } from './user.model';
import { LoginAttempt } from '../auth/loginAttempt.model';
import { Repo } from '../repos/repo.model';
import { Analysis } from '../analyses/analysis.model';
import { GraphNode } from '../graph/graphNode.model';
import { GraphEdge } from '../graph/graphEdge.model';
import { FileSnapshot } from '../graph/fileSnapshot.model';
import { FileEmbedding } from '../graph/fileEmbedding.model';
import { Explanation } from '../ai/explanation.model';
import { AiUsage } from '../ai/usage.model';
import { SavedView } from '../workspace/savedView.model';
import { PinnedFinding } from '../workspace/pinnedFinding.model';
import { cancelUserJobs } from '../../services/analyzer/queue';

/**
 * User data control (PRD §10.5 / blueprint data & privacy).
 *  - Account deletion HARD-deletes every derived record (erasure, not soft
 *    delete): repos, analyses, graph, snapshots, embeddings, AI cache/usage,
 *    saved views, pins and the user document itself.
 *  - Export returns only metadata the user owns — never tokens, password
 *    hashes, refresh sessions or source code.
 */

export async function deleteAccount(userId: string): Promise<void> {
  const user = await User.findById(userId).lean();
  if (!user) throw notFound('User not found');

  // Drop queued analyses and stop in-flight pipelines from persisting more
  cancelUserJobs(userId);

  await Promise.all([
    Repo.deleteMany({ userId }),
    Analysis.deleteMany({ userId }),
    GraphNode.deleteMany({ userId }),
    GraphEdge.deleteMany({ userId }),
    FileSnapshot.deleteMany({ userId }),
    FileEmbedding.deleteMany({ userId }),
    Explanation.deleteMany({ userId }),
    AiUsage.deleteMany({ userId }),
    SavedView.deleteMany({ userId }),
    PinnedFinding.deleteMany({ userId }),
    LoginAttempt.deleteMany({ email: user.email }),
  ]);

  await User.deleteOne({ _id: userId });
}

export async function exportUserData(userId: string) {
  const [user, repos, analyses, views, pins] = await Promise.all([
    User.findById(userId).select('name email createdAt').lean(),
    Repo.find({ userId }).sort({ createdAt: 1 }).lean(),
    Analysis.find({ userId }).sort({ createdAt: 1 }).lean(),
    SavedView.find({ userId, isDeleted: false }).sort({ createdAt: 1 }).lean(),
    PinnedFinding.find({ userId, isDeleted: false })
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  if (!user) throw notFound('User not found');

  return {
    exportedAt: new Date().toISOString(),
    formatVersion: 1,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    },
    repos: repos.map((repo) => ({
      id: String(repo._id),
      owner: repo.githubOwner,
      name: repo.githubName,
      url: repo.url,
      branch: repo.branch,
      defaultBranch: repo.defaultBranch ?? null,
      sizeKb: repo.sizeKb ?? null,
      isPrivate: repo.isPrivate ?? false,
      createdAt: repo.createdAt,
    })),
    analyses: analyses.map((analysis) => ({
      id: String(analysis._id),
      repoId: String(analysis.repoId),
      status: analysis.status,
      progress: analysis.progress,
      commitSha: analysis.commitSha ?? null,
      summary: analysis.summary ?? null,
      cycles: analysis.cycles ?? [],
      startedAt: analysis.startedAt ?? null,
      finishedAt: analysis.finishedAt ?? null,
      createdAt: analysis.createdAt,
    })),
    savedViews: views.map((view) => ({
      id: String(view._id),
      repoId: String(view.repoId),
      name: view.name,
      description: view.description ?? null,
      state: view.state,
      isPinned: view.isPinned,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
    })),
    pinnedFindings: pins.map((pin) => ({
      id: String(pin._id),
      repoId: String(pin.repoId),
      analysisId: String(pin.analysisId),
      nodeKey: pin.nodeKey,
      note: pin.note ?? null,
      createdAt: pin.createdAt,
    })),
  };
}

export type UserDataExport = Awaited<ReturnType<typeof exportUserData>>;
