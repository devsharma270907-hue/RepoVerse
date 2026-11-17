import type { AxiosResponse } from 'axios';
import { api, refreshSession } from './client';
import type {
  Analysis,
  ApiSuccess,
  CallersPayload,
  CyclesPayload,
  ExplainPayload,
  GithubRepo,
  GithubTokenStatus,
  GraphPayload,
  GraphTree,
  HealthPayload,
  ImpactDirection,
  ImpactPayload,
  NodeDetail,
  Pagination,
  Pin,
  Repo,
  SavedView,
  SavedViewState,
  SearchPayload,
  SessionInfo,
  User,
} from './types';

function unwrap<T>(response: AxiosResponse<ApiSuccess<T>>): T {
  return response.data.data;
}

/* ── Auth ─────────────────────────────────────────────────────────────── */

export async function login(input: {
  email: string;
  password: string;
}): Promise<{ user: User; accessToken: string }> {
  return unwrap(await api.post<ApiSuccess<{ user: User; accessToken: string }>>('/auth/login', input));
}

export async function register(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ user: User; accessToken: string }> {
  return unwrap(
    await api.post<ApiSuccess<{ user: User; accessToken: string }>>('/auth/register', input)
  );
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}

export { refreshSession };

/* ── Users ────────────────────────────────────────────────────────────── */

export async function getMe(): Promise<User> {
  const data = unwrap(await api.get<ApiSuccess<{ user: User }>>('/users/me'));
  return data.user;
}

export async function setGithubToken(token: string): Promise<GithubTokenStatus> {
  const data = unwrap(
    await api.put<ApiSuccess<{ githubToken: GithubTokenStatus }>>('/users/me/github-token', {
      token,
    })
  );
  return data.githubToken;
}

export async function removeGithubToken(): Promise<GithubTokenStatus> {
  const data = unwrap(
    await api.delete<ApiSuccess<{ githubToken: GithubTokenStatus }>>('/users/me/github-token')
  );
  return data.githubToken;
}

export async function listSessions(): Promise<SessionInfo[]> {
  const data = unwrap(
    await api.get<ApiSuccess<{ sessions: SessionInfo[] }>>('/users/me/sessions')
  );
  return data.sessions;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await api.delete(`/users/me/sessions/${encodeURIComponent(sessionId)}`);
}

export async function revokeAllSessions(): Promise<void> {
  await api.delete('/users/me/sessions');
}

export async function deleteAccount(confirmation: string): Promise<void> {
  await api.delete('/users/me', { data: { confirmation } });
}

export async function exportAccount(): Promise<Blob> {
  const response = await api.get('/users/me/export', { responseType: 'blob' });
  return response.data as Blob;
}

/* ── GitHub discovery ─────────────────────────────────────────────────── */

export async function discoverRepos(input: {
  q?: string;
  owner?: string;
  page?: number;
  limit?: number;
}): Promise<{ repos: GithubRepo[]; pagination: Pagination }> {
  const response = await api.get<ApiSuccess<{ repos: GithubRepo[] }>>('/github/repos', {
    params: input,
  });
  const pagination: Pagination = response.data.pagination ?? {
    total: response.data.data.repos.length,
    page: input.page ?? 1,
    limit: input.limit ?? 20,
    totalPages: 1,
  };
  return { repos: response.data.data.repos, pagination };
}

/* ── Repositories ─────────────────────────────────────────────────────── */

export interface RegisterRepoResult {
  created: boolean;
  repo: Repo;
  analysis: Analysis;
  repoId: string;
  analysisId: string;
  status: Analysis['status'];
  progress: number;
}

export async function registerRepo(input: {
  url: string;
  branch?: string;
}): Promise<RegisterRepoResult> {
  return unwrap(await api.post<ApiSuccess<RegisterRepoResult>>('/repos', input));
}

export async function listRepos(
  page = 1,
  limit = 20
): Promise<{ repos: Repo[]; pagination: Pagination }> {
  const response = await api.get<ApiSuccess<Repo[]>>('/repos', { params: { page, limit } });
  return {
    repos: response.data.data,
    pagination: response.data.pagination ?? {
      total: response.data.data.length,
      page,
      limit,
      totalPages: 1,
    },
  };
}

export async function getRepo(id: string): Promise<Repo> {
  const data = unwrap(await api.get<ApiSuccess<{ repo: Repo }>>(`/repos/${id}`));
  return data.repo;
}

export async function refreshRepo(
  id: string
): Promise<{ analysis: Analysis; analysisId: string; status: Analysis['status'] }> {
  return unwrap(
    await api.post<
      ApiSuccess<{ analysis: Analysis; analysisId: string; status: Analysis['status'] }>
    >(`/repos/${id}/refresh`)
  );
}

export async function listRepoAnalyses(
  id: string,
  page = 1,
  limit = 20
): Promise<{ analyses: Analysis[]; pagination: Pagination }> {
  const response = await api.get<ApiSuccess<Analysis[]>>(`/repos/${id}/analyses`, {
    params: { page, limit },
  });
  return {
    analyses: response.data.data,
    pagination: response.data.pagination ?? {
      total: response.data.data.length,
      page,
      limit,
      totalPages: 1,
    },
  };
}

export async function deleteRepo(id: string): Promise<void> {
  await api.delete(`/repos/${id}`);
}

/* ── Analyses ─────────────────────────────────────────────────────────── */

export async function getAnalysis(id: string): Promise<Analysis> {
  const data = unwrap(await api.get<ApiSuccess<{ analysis: Analysis }>>(`/analyses/${id}`));
  return data.analysis;
}

export async function listPins(analysisId: string): Promise<Pin[]> {
  const data = unwrap(
    await api.get<ApiSuccess<{ analysisId: string; pins: Pin[] }>>(
      `/analyses/${analysisId}/pins`
    )
  );
  return data.pins;
}

export async function createPin(
  analysisId: string,
  input: { nodeKey: string; note?: string }
): Promise<Pin> {
  const data = unwrap(
    await api.post<ApiSuccess<{ pin: Pin }>>(`/analyses/${analysisId}/pins`, input)
  );
  return data.pin;
}

export async function downloadReport(analysisId: string): Promise<Blob> {
  const response = await api.get(`/analyses/${analysisId}/report`, {
    params: { format: 'markdown' },
    responseType: 'blob',
  });
  return response.data as Blob;
}

/* ── Graph ────────────────────────────────────────────────────────────── */

export async function getGraph(
  analysisId: string,
  level: 'file' | 'symbol'
): Promise<GraphPayload> {
  return unwrap(
    await api.get<ApiSuccess<GraphPayload>>(`/graph/${analysisId}`, { params: { level } })
  );
}

export async function getGraphTree(analysisId: string): Promise<GraphTree> {
  return unwrap(await api.get<ApiSuccess<GraphTree>>(`/graph/${analysisId}/tree`));
}

export async function getGraphNode(analysisId: string, node: string): Promise<NodeDetail> {
  return unwrap(
    await api.get<ApiSuccess<NodeDetail>>(`/graph/${analysisId}/node`, {
      params: { node },
    })
  );
}

export async function getCallers(
  analysisId: string,
  node: string,
  depth = 2
): Promise<CallersPayload> {
  return unwrap(
    await api.get<ApiSuccess<CallersPayload>>(`/graph/${analysisId}/callers`, {
      params: { node, depth },
    })
  );
}

/* ── Insights ─────────────────────────────────────────────────────────── */

export async function getHealth(analysisId: string): Promise<HealthPayload> {
  return unwrap(await api.get<ApiSuccess<HealthPayload>>(`/insights/${analysisId}/health`));
}

export async function getCycles(analysisId: string): Promise<CyclesPayload> {
  return unwrap(await api.get<ApiSuccess<CyclesPayload>>(`/insights/${analysisId}/cycles`));
}

export async function getImpact(
  analysisId: string,
  node: string,
  direction: ImpactDirection
): Promise<ImpactPayload> {
  return unwrap(
    await api.get<ApiSuccess<ImpactPayload>>(`/insights/${analysisId}/impact`, {
      params: { node, direction },
    })
  );
}

/* ── AI ───────────────────────────────────────────────────────────────── */

export async function explainNode(analysisId: string, node: string): Promise<ExplainPayload> {
  return unwrap(
    await api.post<ApiSuccess<ExplainPayload>>(`/ai/analyses/${analysisId}/explain`, { node })
  );
}

export async function smartSearch(analysisId: string, query: string): Promise<SearchPayload> {
  return unwrap(
    await api.post<ApiSuccess<SearchPayload>>(`/ai/analyses/${analysisId}/search`, { query })
  );
}

/* ── Workspace ────────────────────────────────────────────────────────── */

export interface CreateViewInput {
  name: string;
  description?: string;
  state: Partial<SavedViewState> & { level: 'file' | 'symbol' };
  isPinned?: boolean;
}

export async function listViews(repoId: string): Promise<SavedView[]> {
  const data = unwrap(
    await api.get<ApiSuccess<{ repoId: string; views: SavedView[] }>>(`/repos/${repoId}/views`)
  );
  return data.views;
}

export async function createView(repoId: string, input: CreateViewInput): Promise<SavedView> {
  const data = unwrap(
    await api.post<ApiSuccess<{ view: SavedView }>>(`/repos/${repoId}/views`, input)
  );
  return data.view;
}

export async function getView(viewId: string): Promise<SavedView> {
  const data = unwrap(
    await api.get<ApiSuccess<{ view: SavedView }>>(`/workspace/views/${viewId}`)
  );
  return data.view;
}

export async function updateView(
  viewId: string,
  input: Partial<{
    name: string;
    description: string | null;
    state: Partial<SavedViewState>;
    isPinned: boolean;
  }>
): Promise<SavedView> {
  const data = unwrap(await api.patch<ApiSuccess<{ view: SavedView }>>(`/workspace/views/${viewId}`, input));
  return data.view;
}

export async function deleteView(viewId: string): Promise<void> {
  await api.delete(`/workspace/views/${viewId}`);
}

export async function updatePin(pinId: string, note: string | null): Promise<Pin> {
  const data = unwrap(await api.patch<ApiSuccess<{ pin: Pin }>>(`/workspace/pins/${pinId}`, { note }));
  return data.pin;
}

export async function deletePin(pinId: string): Promise<void> {
  await api.delete(`/workspace/pins/${pinId}`);
}
