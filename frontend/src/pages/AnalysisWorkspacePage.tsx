import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  useAnalysis,
  useCreatePin,
  useCreateView,
  useCycles,
  useDeletePin,
  useExplainMutation,
  useGraph,
  useGraphTree,
  useHealth,
  useImpact,
  usePins,
  useRefreshRepo,
  useRepo,
  useView,
  useViews,
} from '@/api/hooks';
import type { GraphNodeKind, ImpactDirection } from '@/api/types';
import { downloadReport } from '@/api/endpoints';
import { Icon } from '@/components/Icon';
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Modal,
  Spinner,
  Tabs,
} from '@/components/ui';
import { StatusBadge } from '@/components/StatusBadge';
import { GraphCanvas } from '@/features/graph/GraphCanvas';
import { FileTree } from '@/features/graph/FileTree';
import { InspectorPanel } from '@/features/graph/InspectorPanel';
import { ImpactPanel } from '@/features/insights/ImpactPanel';
import { HealthDashboard } from '@/features/insights/HealthDashboard';
import { CyclesDashboard } from '@/features/insights/CyclesDashboard';
import { ExplainDrawer } from '@/features/ai/ExplainDrawer';
import { AnalysisProgressView } from '@/features/analysis/AnalysisProgressView';
import { usePalette } from '@/features/palette/PaletteProvider';
import type { WorkspaceView } from '@/features/palette/PaletteProvider';
import { fileKey, filePathOfKey, labelOfKey } from '@/lib/nodeKey';
import { env } from '@/lib/env';
import { formatNumber, formatRelative, shortSha } from '@/lib/format';
import { toAppError, friendlyMessage } from '@/lib/errors';
import { downloadBlob } from '@/lib/download';

type Level = 'file' | 'symbol';

const KIND_LABEL: Record<GraphNodeKind, string> = {
  repo: 'Repo',
  file: 'Files',
  class: 'Classes',
  function: 'Functions',
  method: 'Methods',
};

export function AnalysisWorkspacePage() {
  const { analysisId } = useParams<{ analysisId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewId = searchParams.get('viewId');

  const analysisQuery = useAnalysis(analysisId);
  const analysis = analysisQuery.data;
  const isDone = analysis?.status === 'done';

  const repoQuery = useRepo(analysis?.repoId);
  const repo = repoQuery.data;

  const [level, setLevel] = useState<Level>('file');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>('map');
  const [searchQuery, setSearchQuery] = useState('');
  const [treeFilter, setTreeFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<Set<GraphNodeKind>>(new Set());
  const [impactMode, setImpactMode] = useState(false);
  const [impactDirection, setImpactDirection] = useState<ImpactDirection>('dependents');
  const [cyclePaths, setCyclePaths] = useState<Set<string> | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [railOpen, setRailOpen] = useState(true);
  const [explainKey, setExplainKey] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const graphQuery = useGraph(analysisId ?? '', level, Boolean(isDone));
  const treeQuery = useGraphTree(analysisId ?? '', Boolean(isDone));
  const healthQuery = useHealth(analysisId ?? '', Boolean(isDone) && view === 'health');
  const cyclesQuery = useCycles(analysisId ?? '', Boolean(isDone) && view === 'cycles');
  const pinsQuery = usePins(analysisId ?? '', Boolean(isDone));
  const viewsQuery = useViews(analysis?.repoId, Boolean(isDone));
  const savedViewQuery = useView(viewId);

  const impactQuery = useImpact(
    analysisId ?? '',
    selectedKey,
    impactDirection,
    Boolean(isDone) && impactMode && Boolean(selectedKey)
  );

  const explain = useExplainMutation(analysisId ?? '');
  const createPin = useCreatePin(analysisId ?? '');
  const deletePin = useDeletePin(analysisId ?? '');
  const createView = useCreateView(analysis?.repoId);
  const refresh = useRefreshRepo();
  const { setWorkspace, openPalette } = usePalette();

  const appliedView = useRef<string | null>(null);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Apply a saved view exactly once per viewId.
  useEffect(() => {
    if (!viewId || !savedViewQuery.data) return;
    if (appliedView.current === viewId) return;
    appliedView.current = viewId;

    const state = savedViewQuery.data.state;
    setLevel(state.level);
    setSearchQuery(state.searchQuery ?? '');
    setKindFilter(new Set(state.filterKinds as GraphNodeKind[]));
    setView('map');
    setImpactMode(false);
    setCyclePaths(null);

    const focus = state.focusNode ?? state.isolatedNode ?? null;
    if (focus) {
      setSelectedKey(focus);
      setFocusKey(focus);
      setFocusNonce((value) => value + 1);
    }

    showNotice(`Applied view “${savedViewQuery.data.name}”`);
    setSearchParams({}, { replace: true });
  }, [viewId, savedViewQuery.data, setSearchParams, showNotice]);

  // If a saved view cannot be found, drop the stale parameter quietly.
  useEffect(() => {
    if (viewId && savedViewQuery.isError) {
      setSearchParams({}, { replace: true });
    }
  }, [viewId, savedViewQuery.isError, setSearchParams]);

  const focusNode = useCallback(
    (
      key: string,
      options: { keepImpact?: boolean; keepCycle?: boolean } = {}
    ) => {
      if (!options.keepImpact) setImpactMode(false);
      if (!options.keepCycle) setCyclePaths(null);
      if (key.startsWith('sym:')) setLevel('symbol');
      setView('map');
      setSelectedKey(key);
      setFocusKey(key);
      setFocusNonce((value) => value + 1);
    },
    []
  );

  const explainNode = useCallback(
    (key: string) => {
      setExplainKey(key);
      explain.mutate(key);
    },
    [explain]
  );

  const toggleImpact = useCallback(() => {
    if (!env.enableImpactMode) {
      showNotice('Impact mode is disabled for this deployment.');
      return;
    }
    if (!selectedKey) {
      showNotice('Select a node on the map first.');
      return;
    }
    if (cyclePaths) setCyclePaths(null);
    setImpactMode((value) => !value);
  }, [selectedKey, cyclePaths, showNotice]);

  const highlightCycle = useCallback(
    (paths: string[]) => {
      const set = new Set(paths);
      setCyclePaths(set);
      setImpactMode(false);
      setView('map');
      setRailOpen(true);
      const first = paths[0];
      if (first) {
        const key = fileKey(first);
        setSelectedKey(key);
        setFocusKey(key);
        setFocusNonce((value) => value + 1);
      }
    },
    []
  );

  // Register this workspace with the global command palette.
  useEffect(() => {
    if (!graphQuery.data) {
      setWorkspace(null);
      return;
    }
    setWorkspace({
      analysisId: analysisId ?? '',
      nodes: graphQuery.data.nodes,
      selectedKey,
      onSelectNode: focusNode,
      onExplainNode: explainNode,
      onSetView: (next) => setView(next),
    });
    return () => setWorkspace(null);
  }, [graphQuery.data, analysisId, selectedKey, focusNode, explainNode, setWorkspace]);

  const graph = graphQuery.data;
  const selectedPath = selectedKey ? filePathOfKey(selectedKey) : null;

  const kinds = useMemo(() => {
    if (!graph) return [] as GraphNodeKind[];
    const present = new Set<GraphNodeKind>();
    for (const node of graph.nodes) {
      if (node.kind !== 'repo') present.add(node.kind);
    }
    return [...present];
  }, [graph]);

  const searchMatchCount = useMemo(() => {
    if (!graph || !searchQuery.trim()) return 0;
    const needle = searchQuery.trim().toLowerCase();
    return graph.nodes.filter((node) =>
      `${node.name ?? ''} ${node.path ?? ''} ${node.id}`.toLowerCase().includes(needle)
    ).length;
  }, [graph, searchQuery]);

  const impactPaths = useMemo(() => {
    if (!impactMode || !impactQuery.data) return null;
    const paths = new Set(impactQuery.data.affected.map((item) => item.path));
    paths.add(impactQuery.data.node);
    return paths;
  }, [impactMode, impactQuery.data]);

  const handleRefresh = async (): Promise<void> => {
    if (!analysis) return;
    try {
      const result = await refresh.mutateAsync(analysis.repoId);
      navigate(`/analyses/${result.analysisId}`);
    } catch (err) {
      showNotice(friendlyMessage(toAppError(err)));
    }
  };

  const handleReport = async (): Promise<void> => {
    if (!analysisId) return;
    try {
      const blob = await downloadReport(analysisId);
      downloadBlob(blob, `repoverse-${analysisId}.md`);
    } catch (err) {
      showNotice(friendlyMessage(toAppError(err)));
    }
  };

  const handleSaveView = async (): Promise<void> => {
    if (!analysis?.repoId) return;
    const name = viewName.trim();
    if (!name) return;
    try {
      await createView.mutateAsync({
        name,
        state: {
          level,
          ...(searchQuery.trim() ? { searchQuery: searchQuery.trim() } : {}),
          ...(selectedKey ? { focusNode: selectedKey, isolatedNode: selectedKey } : {}),
          highlightedNodes: cyclePaths ? [...cyclePaths].map(fileKey) : selectedKey ? [selectedKey] : [],
          filterKinds: [...kindFilter],
        },
      });
      setSaveOpen(false);
      setViewName('');
      showNotice('View saved. Reopen it from the repository page or command palette.');
    } catch (err) {
      showNotice(friendlyMessage(toAppError(err)));
    }
  };

  const handlePin = async (nodeKey: string, note: string): Promise<void> => {
    try {
      await createPin.mutateAsync({
        nodeKey,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      showNotice('Pinned finding saved.');
    } catch (err) {
      showNotice(friendlyMessage(toAppError(err)));
    }
  };

  if (analysisQuery.isLoading) {
    return (
      <div className="loading-block">
        <Spinner label="Loading analysis…" />
      </div>
    );
  }

  if (analysisQuery.error || !analysis) {
    return (
      <div className="page">
        <ErrorNotice
          error={{
            code: 'ANALYSIS_UNAVAILABLE',
            message:
              analysisQuery.error instanceof Error
                ? analysisQuery.error.message
                : 'Analysis not found.',
          }}
          onRetry={() => void analysisQuery.refetch()}
        />
        <Button variant="ghost" icon="arrow-left" onClick={() => navigate('/')}>
          Back to repositories
        </Button>
      </div>
    );
  }

  const summary = analysis.summary;
  const explainError = explain.error ? toAppError(explain.error) : null;

  return (
    <div className="page workspace">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/">Repositories</Link>
        <Icon name="chevron-right" size={13} />
        {repo ? (
          <Link to={`/repos/${repo.id}`}>
            {repo.owner}/{repo.name}
          </Link>
        ) : (
          <span>Repository</span>
        )}
        <Icon name="chevron-right" size={13} />
        <span>{shortSha(analysis.commitSha)}</span>
      </nav>

      <header className="workspace__header">
        <div className="workspace__identity">
          <div className="workspace__title">
            <h1>{repo ? `${repo.owner}/${repo.name}` : 'Repository analysis'}</h1>
            <StatusBadge status={analysis.status} />
          </div>
          <div className="workspace__meta">
            <span>
              <Icon name="code" size={13} /> {shortSha(analysis.commitSha)}
            </span>
            <span>
              <Icon name="clock" size={13} /> {formatRelative(analysis.createdAt)}
            </span>
            {summary ? (
              <>
                <span>{formatNumber(summary.fileCount)} files</span>
                <span>{formatNumber(summary.symbolCount)} symbols</span>
                <span>{summary.cycleCount} cycles</span>
                <span className="workspace__score">health {summary.healthScore}</span>
                {summary.truncated ? <Badge tone="amber">truncated</Badge> : null}
                {summary.diff ? <Badge tone="blue">diff-aware refresh</Badge> : null}
              </>
            ) : null}
          </div>
        </div>
        <div className="workspace__actions">
          <Button
            variant="ghost"
            size="sm"
            icon="search"
            onClick={() => openPalette()}
            title="Command palette (⌘K)"
          >
            ⌘K
          </Button>
          {isDone ? (
            <Button variant="ghost" size="sm" icon="download" onClick={() => void handleReport()}>
              Report
            </Button>
          ) : null}
          {isDone ? (
            <Button
              variant="ghost"
              size="sm"
              icon="book"
              onClick={() => {
                setViewName('');
                setSaveOpen(true);
              }}
            >
              Save view
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            icon="refresh"
            loading={refresh.isPending}
            onClick={() => void handleRefresh()}
          >
            Re-analyze
          </Button>
        </div>
      </header>

      {notice ? (
        <div className="notice-bar" role="status">
          <Icon name="info" size={15} /> {notice}
          <button type="button" className="link-button" onClick={() => setNotice(null)}>
            dismiss
          </button>
        </div>
      ) : null}

      {analysis.status !== 'done' ? (
        <AnalysisProgressView
          analysis={analysis}
          repo={repo}
          onRetry={() => void handleRefresh()}
          retrying={refresh.isPending}
          onBack={() => (repo ? navigate(`/repos/${repo.id}`) : navigate('/'))}
          onOpenRepos={() => navigate('/')}
        />
      ) : (
        <>
          <div className="workspace__tabs-row">
            <Tabs
              tabs={[
                { id: 'map', label: 'Map', icon: 'graph' },
                { id: 'health', label: 'Health', icon: 'health' },
                {
                  id: 'cycles',
                  label: 'Cycles',
                  icon: 'cycle',
                  count: summary?.cycleCount ?? 0,
                },
              ]}
              value={view}
              onChange={setView}
              ariaLabel="Workspace views"
            />

            {view === 'map' ? (
              <div className="workspace__map-tools">
                <div className="segmented segmented--sm" role="group" aria-label="Graph level">
                  <button
                    type="button"
                    className={level === 'file' ? 'segmented--active' : ''}
                    onClick={() => {
                      setLevel('file');
                      if (selectedKey?.startsWith('sym:')) setSelectedKey(null);
                    }}
                  >
                    Files
                  </button>
                  <button
                    type="button"
                    className={level === 'symbol' ? 'segmented--active' : ''}
                    onClick={() => setLevel('symbol')}
                  >
                    Symbols
                  </button>
                </div>

                <div className="toolbar__search toolbar__search--grow">
                  <Icon name="search" size={15} />
                  <input
                    className="input input--sm"
                    placeholder="Highlight by name or path…"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setSearchQuery('')}
                    >
                      clear
                    </button>
                  ) : null}
                </div>

                {searchQuery.trim() ? (
                  <Badge tone={searchMatchCount > 0 ? 'blue' : 'amber'}>
                    {searchMatchCount} match{searchMatchCount === 1 ? '' : 'es'}
                  </Badge>
                ) : null}

                <Button
                  size="sm"
                  variant="ghost"
                  icon="sparkles"
                  onClick={() => openPalette({ mode: 'ai', prefill: searchQuery })}
                >
                  Ask AI
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  icon={railOpen ? 'chevron-right' : 'arrow-left'}
                  onClick={() => setRailOpen((value) => !value)}
                >
                  {railOpen ? 'Hide panel' : 'Show panel'}
                </Button>
              </div>
            ) : null}
          </div>

          {view === 'map' ? (
            <div className="workspace__chips">
              {kinds.map((kind) => {
                const active = kindFilter.size === 0 || kindFilter.has(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    className={['filter-chip', active ? 'filter-chip--active' : ''].filter(Boolean).join(' ')}
                    onClick={() => {
                      setKindFilter((current) => {
                        const next = new Set(current);
                        if (next.size === 0) {
                          // First click isolates the chosen kind.
                          next.add(kind);
                        } else if (next.has(kind)) {
                          next.delete(kind);
                        } else {
                          next.add(kind);
                        }
                        return next;
                      });
                    }}
                  >
                    {KIND_LABEL[kind]}
                  </button>
                );
              })}
              {kindFilter.size > 0 ? (
                <button type="button" className="filter-chip" onClick={() => setKindFilter(new Set())}>
                  All
                </button>
              ) : null}
              <span className="workspace__chips-spacer" />
              {cyclePaths ? (
                <Badge tone="violet" icon="cycle">
                  Cycle highlight · {cyclePaths.size} files
                  <button
                    type="button"
                    className="badge__action"
                    onClick={() => setCyclePaths(null)}
                    aria-label="Clear cycle highlight"
                  >
                    <Icon name="close" size={11} />
                  </button>
                </Badge>
              ) : null}
              {selectedPath ? (
                <Badge tone="gray" icon="file">
                  {selectedPath}
                </Badge>
              ) : null}
            </div>
          ) : null}

          <div
            className={[
              'workspace__body',
              view !== 'map' ? 'workspace__body--full' : '',
              view === 'map' && !railOpen ? 'workspace__body--collapsed' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {view === 'map' ? (
              <aside className="workspace__tree" aria-label="File tree">
                <div className="workspace__tree-head">
                  <span>Structure</span>
                  {treeQuery.data ? <Badge tone="gray">{treeQuery.data.fileCount}</Badge> : null}
                </div>
                <div className="toolbar__search toolbar__search--compact">
                  <Icon name="search" size={13} />
                  <input
                    className="input input--sm"
                    placeholder="Filter files…"
                    value={treeFilter}
                    onChange={(event) => setTreeFilter(event.target.value)}
                  />
                </div>
                {treeQuery.isLoading ? (
                  <div className="loading-block loading-block--compact">
                    <Spinner />
                  </div>
                ) : treeQuery.error ? (
                  <p className="muted muted--pad">File tree unavailable.</p>
                ) : treeQuery.data ? (
                  <FileTree
                    tree={treeQuery.data}
                    selectedPath={selectedPath}
                    onSelectFile={(path) => focusNode(fileKey(path))}
                    query={treeFilter}
                  />
                ) : null}
              </aside>
            ) : null}

            <section className="workspace__stage" aria-label="Workspace view">
              {view === 'map' ? (
                graphQuery.isLoading ? (
                  <div className="loading-block">
                    <Spinner label="Building the map…" />
                  </div>
                ) : graphQuery.error ? (
                  <ErrorNotice
                    error={{
                      code: 'GRAPH_UNAVAILABLE',
                      message:
                        graphQuery.error instanceof Error
                          ? graphQuery.error.message
                          : 'Could not load the graph.',
                    }}
                    onRetry={() => void graphQuery.refetch()}
                  />
                ) : graph ? (
                  <GraphCanvas
                    graph={graph}
                    level={level}
                    selectedKey={selectedKey}
                    onSelect={(key) =>
                      focusNode(key, { keepImpact: impactMode, keepCycle: Boolean(cyclePaths) })
                    }
                    searchQuery={searchQuery}
                    kindFilter={kindFilter}
                    highlightPaths={impactPaths}
                    cyclePaths={cyclePaths}
                    focusKey={focusKey}
                    focusNonce={focusNonce}
                  />
                ) : (
                  <EmptyState icon="graph" title="No graph data" />
                )
              ) : view === 'health' ? (
                <HealthDashboard
                  data={healthQuery.data}
                  isLoading={healthQuery.isLoading}
                  error={healthQuery.error}
                  onRetry={() => void healthQuery.refetch()}
                  onLocate={(key) => focusNode(key)}
                  onExplain={(key) => explainNode(key)}
                />
              ) : (
                <CyclesDashboard
                  data={cyclesQuery.data}
                  isLoading={cyclesQuery.isLoading}
                  error={cyclesQuery.error}
                  onRetry={() => void cyclesQuery.refetch()}
                  nodes={graph?.nodes ?? []}
                  edges={graph?.edges ?? []}
                  onHighlight={highlightCycle}
                  onExplainFile={(key) => explainNode(key)}
                />
              )}
            </section>

            {view === 'map' && railOpen ? (
              <aside className="workspace__rail" aria-label="Inspector">
                {impactMode && selectedKey ? (
                  <ImpactPanel
                    data={impactQuery.data}
                    isLoading={impactQuery.isLoading}
                    error={impactQuery.error}
                    direction={impactDirection}
                    onDirectionChange={setImpactDirection}
                    onSelectPath={(path) => focusNode(fileKey(path), { keepImpact: true })}
                    onExplainPath={(path) => explainNode(fileKey(path))}
                    onBack={() => setImpactMode(false)}
                    onRetry={() => void impactQuery.refetch()}
                  />
                ) : (
                  <InspectorPanel
                    analysisId={analysisId ?? ''}
                    selectedKey={selectedKey}
                    onSelectNode={(key) => focusNode(key)}
                    onExplain={explainNode}
                    onImpact={toggleImpact}
                    impactEnabled={impactMode}
                    pins={pinsQuery.data ?? []}
                    onPin={handlePin}
                    onDeletePin={(pinId) => {
                      void deletePin.mutateAsync(pinId).catch((err: unknown) => {
                        showNotice(friendlyMessage(toAppError(err)));
                      });
                    }}
                    pinPending={createPin.isPending}
                    onSelectPinned={(key) => focusNode(key)}
                  />
                )}
              </aside>
            ) : null}
          </div>
        </>
      )}

      <ExplainDrawer
        open={Boolean(explainKey)}
        nodeKey={explainKey}
        data={explain.data}
        isLoading={explain.isPending}
        error={explainError}
        onClose={() => {
          setExplainKey(null);
          explain.reset();
        }}
        onRetry={() => {
          if (explainKey) explain.mutate(explainKey);
        }}
      />

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save this view"
        description="Saved views store map intent only — level, focus node, highlights and filters. Never source code."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="book"
              loading={createView.isPending}
              disabled={!viewName.trim()}
              onClick={() => void handleSaveView()}
            >
              Save view
            </Button>
          </>
        }
      >
        <Field label="View name" htmlFor="view-name" hint="Names are unique per repository.">
          <Input
            id="view-name"
            placeholder="Auth flow, hot path, data layer…"
            value={viewName}
            maxLength={80}
            autoFocus
            onChange={(event) => setViewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && viewName.trim()) {
                event.preventDefault();
                void handleSaveView();
              }
            }}
          />
        </Field>
        <div className="save-view-summary">
          <span>Level: {level}</span>
          <span>Focus: {selectedKey ? labelOfKey(selectedKey) : 'none'}</span>
          <span>Highlights: {cyclePaths ? cyclePaths.size : selectedKey ? 1 : 0}</span>
          <span>Filters: {kindFilter.size === 0 ? 'all kinds' : `${kindFilter.size} kinds`}</span>
          {viewsQuery.data ? <span>Saved views: {viewsQuery.data.length}</span> : null}
        </div>
      </Modal>

      <p className="workspace__footnote">
        <Icon name="shield" size={13} /> Source is never persisted client-side. AI content is
        sanitized and rendered as text. <Badge tone="gray">graph {graph?.nodes.length ?? 0} nodes</Badge>
      </p>
    </div>
  );
}
