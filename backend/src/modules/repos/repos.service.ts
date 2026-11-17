import { AppError, notFound } from '../../utils/appError';
import { parseGitHubUrl } from '../../utils/githubUrl';
import { fetchRepoMeta } from '../../services/analyzer/fetcher';
import { resolveUserGithubToken } from '../users/githubToken.service';
import { Repo, RepoDocument } from './repo.model';
import { startAnalysisForRepo } from '../analyses/analyses.service';
import { AnalysisDocument } from '../analyses/analysis.model';

export interface RegisterRepoResult {
  repo: RepoDocument;
  analysis: AnalysisDocument;
  created: boolean;
}

/**
 * Register (or re-open) a GitHub repo and queue an analysis.
 * Business rules (PRD §11):
 *  - URL allowlist enforced by parseGitHubUrl + GitHub API re-validation
 *  - size/visibility pre-checks BEFORE any heavy work
 *  - re-adding an existing repo re-runs analysis instead of 409
 */
export async function registerRepo(
  userId: string,
  input: { url: string; branch?: string }
): Promise<RegisterRepoResult> {
  const parsed = parseGitHubUrl(input.url);
  if (!parsed) {
    throw new AppError(
      400,
      'INVALID_REQUEST',
      'Not a github.com repository URL'
    );
  }

  // GitHub API pre-check — fails fast on 404/private/oversized (PRD §10.1).
  // The user's encrypted PAT (if connected) authorizes private repos.
  const token = await resolveUserGithubToken(userId);
  const meta = await fetchRepoMeta(parsed.owner, parsed.name, token);
  const branch = input.branch ?? meta.defaultBranch;

  // Re-adding (incl. a previously soft-deleted repo) → restore, don't duplicate
  let repo = await Repo.findOne({
    userId,
    githubOwner: meta.owner,
    githubName: meta.name,
    branch,
  });
  let created = false;
  if (repo) {
    if (repo.isDeleted) {
      repo.isDeleted = false;
      repo.deletedAt = undefined;
      repo.isPrivate = meta.isPrivate;
      await repo.save();
    }
  } else {
    repo = await Repo.create({
      userId,
      githubOwner: meta.owner,
      githubName: meta.name,
      url: `https://github.com/${meta.fullName}`,
      branch,
      defaultBranch: meta.defaultBranch,
      sizeKb: meta.sizeKb,
      isPrivate: meta.isPrivate,
    });
    created = true;
  }

  const analysis = await startAnalysisForRepo(repo);
  return { repo, analysis, created };
}

export async function refreshRepo(
  repo: RepoDocument
): Promise<AnalysisDocument> {
  return startAnalysisForRepo(repo);
}

export async function softDeleteRepo(repo: RepoDocument): Promise<void> {
  repo.isDeleted = true;
  repo.deletedAt = new Date();
  await repo.save();
}

export async function listRepos(
  userId: string,
  page: number,
  limit: number
): Promise<{ repos: RepoDocument[]; total: number }> {
  const filter = { userId, isDeleted: false };
  const [repos, total] = await Promise.all([
    Repo.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Repo.countDocuments(filter),
  ]);
  return { repos: repos as RepoDocument[], total };
}

export async function getRepoOrThrow(userId: string, repoId: string): Promise<RepoDocument> {
  const repo = await Repo.findOne({ _id: repoId, userId, isDeleted: false });
  if (!repo) throw notFound();
  return repo;
}
