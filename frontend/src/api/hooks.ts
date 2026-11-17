import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createPin,
  createView,
  deletePin,
  deleteRepo,
  deleteView,
  explainNode,
  getAnalysis,
  getCallers,
  getCycles,
  getGraph,
  getGraphNode,
  getGraphTree,
  getHealth,
  getImpact,
  getMe,
  getRepo,
  getView,
  listPins,
  listRepoAnalyses,
  listRepos,
  listSessions,
  listViews,
  refreshRepo,
  registerRepo,
  smartSearch,
  updatePin,
  updateView,
} from './endpoints';
import type { CreateViewInput } from './endpoints';
import type { ImpactDirection } from './types';
import { TERMINAL_STATUSES } from './types';

export const queryKeys = {
  me: ['me'] as const,
  sessions: ['sessions'] as const,
  repos: (page: number) => ['repos', page] as const,
  repo: (id: string) => ['repo', id] as const,
  repoAnalyses: (id: string) => ['repo-analyses', id] as const,
  analysis: (id: string) => ['analysis', id] as const,
  graph: (id: string, level: string) => ['graph', id, level] as const,
  tree: (id: string) => ['tree', id] as const,
  node: (id: string, key: string) => ['node', id, key] as const,
  callers: (id: string, key: string, depth: number) =>
    ['callers', id, key, depth] as const,
  health: (id: string) => ['health', id] as const,
  cycles: (id: string) => ['cycles', id] as const,
  impact: (id: string, key: string, direction: ImpactDirection) =>
    ['impact', id, key, direction] as const,
  pins: (id: string) => ['pins', id] as const,
  views: (repoId: string) => ['views', repoId] as const,
  view: (viewId: string) => ['view', viewId] as const,
};

/* ── Account ──────────────────────────────────────────────────────────── */

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: getMe });
}

export function useSessions() {
  return useQuery({ queryKey: queryKeys.sessions, queryFn: listSessions });
}

/* ── Repositories ─────────────────────────────────────────────────────── */

export function useRepos(page = 1) {
  return useQuery({
    queryKey: queryKeys.repos(page),
    queryFn: () => listRepos(page),
    placeholderData: (previous) => previous,
  });
}

export function useRepo(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.repo(id ?? ''),
    queryFn: () => getRepo(id as string),
    enabled: Boolean(id),
  });
}

export function useRepoAnalyses(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.repoAnalyses(id ?? ''),
    queryFn: () => listRepoAnalyses(id as string),
    enabled: Boolean(id),
  });
}

export function useRegisterRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: registerRepo,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
  });
}

export function useRefreshRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => refreshRepo(repoId),
    onSuccess: (_data, repoId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repoAnalyses(repoId) });
      void queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
  });
}

export function useDeleteRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => deleteRepo(repoId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
  });
}

/* ── Analyses & graph ─────────────────────────────────────────────────── */

export function useAnalysis(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.analysis(id ?? ''),
    queryFn: () => getAnalysis(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 3000;
      return TERMINAL_STATUSES.includes(data.status) ? false : 2500;
    },
  });
}

export function useGraph(id: string, level: 'file' | 'symbol', enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.graph(id, level),
    queryFn: () => getGraph(id, level),
    enabled,
    staleTime: 60_000,
  });
}

export function useGraphTree(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.tree(id),
    queryFn: () => getGraphTree(id),
    enabled,
    staleTime: 60_000,
  });
}

export function useNodeDetail(id: string, key: string | null) {
  return useQuery({
    queryKey: queryKeys.node(id, key ?? ''),
    queryFn: () => getGraphNode(id, key as string),
    enabled: Boolean(key),
    staleTime: 30_000,
  });
}

export function useCallers(id: string, key: string | null, depth: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.callers(id, key ?? '', depth),
    queryFn: () => getCallers(id, key as string, depth),
    enabled: Boolean(key) && enabled,
  });
}

/* ── Insights ─────────────────────────────────────────────────────────── */

export function useHealth(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.health(id),
    queryFn: () => getHealth(id),
    enabled,
    staleTime: 60_000,
  });
}

export function useCycles(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.cycles(id),
    queryFn: () => getCycles(id),
    enabled,
    staleTime: 60_000,
  });
}

export function useImpact(
  id: string,
  key: string | null,
  direction: ImpactDirection,
  enabled: boolean
) {
  return useQuery({
    queryKey: queryKeys.impact(id, key ?? '', direction),
    queryFn: () => getImpact(id, key as string, direction),
    enabled: Boolean(key) && enabled,
    staleTime: 30_000,
  });
}

/* ── AI ───────────────────────────────────────────────────────────────── */

export function useExplainMutation(analysisId: string) {
  return useMutation({
    mutationFn: (node: string) => explainNode(analysisId, node),
  });
}

export function useSmartSearchMutation(analysisId: string) {
  return useMutation({
    mutationFn: (query: string) => smartSearch(analysisId, query),
  });
}

/* ── Workspace ────────────────────────────────────────────────────────── */

export function usePins(analysisId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.pins(analysisId),
    queryFn: () => listPins(analysisId),
    enabled,
  });
}

export function useCreatePin(analysisId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { nodeKey: string; note?: string }) =>
      createPin(analysisId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pins(analysisId) });
    },
  });
}

export function useUpdatePin(analysisId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { pinId: string; note: string | null }) =>
      updatePin(input.pinId, input.note),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pins(analysisId) });
    },
  });
}

export function useDeletePin(analysisId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pinId: string) => deletePin(pinId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pins(analysisId) });
    },
  });
}

export function useView(viewId: string | null) {
  return useQuery({
    queryKey: queryKeys.view(viewId ?? ''),
    queryFn: () => getView(viewId as string),
    enabled: Boolean(viewId),
    staleTime: 60_000,
  });
}

export function useViews(repoId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.views(repoId ?? ''),
    queryFn: () => listViews(repoId as string),
    enabled: Boolean(repoId) && enabled,
  });
}

export function useCreateView(repoId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateViewInput) => createView(repoId as string, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.views(repoId ?? '') });
    },
  });
}

export function useUpdateView(repoId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      viewId: string;
      name?: string;
      isPinned?: boolean;
      description?: string | null;
    }) => updateView(input.viewId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.views(repoId ?? '') });
    },
  });
}

export function useDeleteView(repoId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (viewId: string) => deleteView(viewId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.views(repoId ?? '') });
    },
  });
}
