import { memo, useCallback, useEffect, useMemo } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GraphEdgeKind, GraphNode, GraphPayload, GraphNodeKind } from '@/api/types';
import { filePathOfKey } from '@/lib/nodeKey';
import { layoutGraph } from './layout';
import { EmptyState } from '@/components/ui';

export interface GraphCanvasProps {
  graph: GraphPayload;
  level: 'file' | 'symbol';
  selectedKey: string | null;
  onSelect: (key: string) => void;
  searchQuery?: string;
  kindFilter?: Set<GraphNodeKind> | null;
  /** Impact mode: paths (files) that are affected by the selected node. */
  highlightPaths?: Set<string> | null;
  /** Cycle mode: files participating in a circular dependency. */
  cyclePaths?: Set<string> | null;
  /** Request to center the map on a node (tree / palette navigation). */
  focusKey?: string | null;
  focusNonce?: number;
  height?: number | string;
}

const EDGE_COLORS: Record<GraphEdgeKind, string> = {
  imports: '#64748b',
  calls: '#38bdf8',
  defines: '#a78bfa',
  extends: '#fb923c',
};

const EDGE_DASH: Partial<Record<GraphEdgeKind, string>> = {
  calls: '5 4',
  defines: '2 4',
};

function nodeLabel(node: GraphNode): string {
  if (node.kind === 'file' || node.kind === 'repo') {
    return node.path ?? node.name ?? node.id;
  }
  return node.name ?? node.id;
}

function nodeTitle(node: GraphNode): string {
  const parts = [node.id];
  if (node.loc) parts.push(`${node.loc} lines`);
  if (node.kind !== 'repo') parts.push(`fan-in ${node.fanIn} · fan-out ${node.fanOut}`);
  return parts.join('\n');
}

function buildNodes(
  graph: GraphPayload,
  positions: ReturnType<typeof layoutGraph>,
  selectedKey: string | null,
  hitPaths: Set<string> | null,
  dimmed: boolean,
  cyclePaths: Set<string> | null
): Node[] {
  return graph.nodes.map((node) => {
    const box = positions.get(node.id);
    const path = node.path ?? filePathOfKey(node.id);
    const isHit =
      !hitPaths ||
      hitPaths.has(node.id) ||
      (path !== null && hitPaths.has(path));
    const isCycle = cyclePaths ? (path !== null && cyclePaths.has(path)) : false;

    const className = [
      'gnode',
      `gnode--${node.kind}`,
      selectedKey === node.id ? 'gnode--selected' : '',
      dimmed && !isHit ? 'gnode--dim' : '',
      cyclePaths && isHit ? 'gnode--cycle' : '',
      !cyclePaths && isCycle ? 'gnode--cycle' : '',
      node.fanIn >= 8 ? 'gnode--hot' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return {
      id: node.id,
      position: { x: box?.x ?? 0, y: box?.y ?? 0 },
      data: { label: nodeLabel(node), tooltip: nodeTitle(node) },
      className,
      draggable: false,
      selectable: true,
      width: box?.width,
      height: box?.height,
    } satisfies Node;
  });
}

function buildEdges(
  graph: GraphPayload,
  nodeIds: Set<string>,
  selectedKey: string | null,
  dimmed: boolean,
  hitPaths: Set<string> | null,
  level: 'file' | 'symbol'
): Edge[] {
  return graph.edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .map((edge) => {
      const color = EDGE_COLORS[edge.kind];
      const touchesSelection =
        selectedKey !== null && (edge.from === selectedKey || edge.to === selectedKey);

      let opacity = 1;
      let width = 1.4;
      if (dimmed) {
        const fromPath = filePathOfKey(edge.from);
        const toPath = filePathOfKey(edge.to);
        const inHit =
          hitPaths &&
          ((fromPath !== null && hitPaths.has(fromPath)) ||
            (toPath !== null && hitPaths.has(toPath)));
        opacity = inHit ? 0.75 : 0.12;
      }
      if (touchesSelection) {
        width = 2.4;
        opacity = 1;
      }

      return {
        id: `${edge.from}->${edge.to}:${edge.kind}`,
        source: edge.from,
        target: edge.to,
        type: level === 'symbol' ? 'default' : 'smoothstep',
        animated: touchesSelection && edge.kind === 'calls',
        style: {
          stroke: color,
          strokeWidth: width,
          opacity,
          strokeDasharray: EDGE_DASH[edge.kind],
        },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        selectable: false,
      } satisfies Edge;
    });
}

function GraphCanvasInner({
  graph,
  level,
  selectedKey,
  onSelect,
  searchQuery = '',
  kindFilter = null,
  highlightPaths = null,
  cyclePaths = null,
  focusKey = null,
  focusNonce = 0,
  height = '100%',
}: GraphCanvasProps) {
  const { fitView, setCenter } = useReactFlow();

  const visibleNodes = useMemo(
    () =>
      graph.nodes.filter(
        (node) =>
          !kindFilter ||
          kindFilter.size === 0 ||
          kindFilter.has(node.kind) ||
          node.kind === 'repo'
      ),
    [graph.nodes, kindFilter]
  );

  const visibleIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes]
  );

  const positions = useMemo(
    () =>
      layoutGraph(
        visibleNodes,
        graph.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
      ),
    [visibleNodes, visibleIds, graph.edges]
  );

  const normalisedQuery = searchQuery.trim().toLowerCase();

  const searchHits = useMemo(() => {
    if (!normalisedQuery) return null;
    const hits = new Set<string>();
    for (const node of visibleNodes) {
      const label = nodeLabel(node).toLowerCase();
      if (label.includes(normalisedQuery) || node.id.toLowerCase().includes(normalisedQuery)) {
        hits.add(node.id);
      }
    }
    // Also treat matching files as hits for their symbols.
    if (level === 'symbol') {
      for (const node of visibleNodes) {
        if (node.path && node.path.toLowerCase().includes(normalisedQuery)) hits.add(node.id);
      }
    }
    return hits;
  }, [visibleNodes, normalisedQuery, level]);

  const hitPaths = useMemo(() => {
    if (highlightPaths) return highlightPaths;
    if (searchHits) {
      const paths = new Set<string>();
      for (const node of visibleNodes) {
        if (searchHits.has(node.id) && node.path) paths.add(node.path);
      }
      return paths.size > 0 ? paths : searchHits;
    }
    return null;
  }, [highlightPaths, searchHits, visibleNodes]);

  const dimmed = hitPaths !== null;

  const nodes = useMemo(
    () =>
      buildNodes(
        { ...graph, nodes: visibleNodes },
        positions,
        selectedKey,
        hitPaths,
        dimmed,
        cyclePaths
      ),
    [graph, visibleNodes, positions, selectedKey, hitPaths, dimmed, cyclePaths]
  );

  const edges = useMemo(
    () =>
      buildEdges(
        graph,
        visibleIds,
        selectedKey,
        dimmed,
        hitPaths,
        level
      ),
    [graph, visibleIds, selectedKey, dimmed, hitPaths, level]
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onSelect(node.id);
    },
    [onSelect]
  );

  // Center the viewport when another panel asks for a specific node.
  useEffect(() => {
    if (!focusKey) return;
    const box = positions.get(focusKey);
    if (!box) return;
    void setCenter(box.x + box.width / 2, box.y + box.height / 2, {
      zoom: 1.15,
      duration: 450,
    });
  }, [focusKey, focusNonce, positions, setCenter]);

  // Fit on level or filter changes (not on every selection).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.18, duration: 350 });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [level, kindFilter, fitView]);

  if (visibleNodes.length === 0) {
    return (
      <div className="graph-empty" style={{ height }}>
        <EmptyState
          icon="graph"
          title="No nodes match this view"
          description="Change the level or clear the filters to see the map."
        />
      </div>
    );
  }

  return (
    <div className="graph-wrap" style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={handleNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.08}
        maxZoom={2.4}
        onlyRenderVisibleElements={visibleNodes.length > 250}
        proOptions={{ hideAttribution: false }}
        aria-label="Repository dependency map"
      >
        <Background gap={22} size={1} color="var(--graph-grid)" />
        <Controls showInteractive={false} position="bottom-left" />
        {visibleNodes.length <= 400 ? (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeStrokeWidth={0}
            maskColor="var(--graph-minimap-mask)"
            nodeColor={(node) => {
              const kind = String(node.className ?? '');
              if (kind.includes('gnode--class')) return '#a78bfa';
              if (kind.includes('gnode--function')) return '#38bdf8';
              if (kind.includes('gnode--method')) return '#34d399';
              if (kind.includes('gnode--repo')) return '#f472b6';
              return '#94a3b8';
            }}
          />
        ) : null}
      </ReactFlow>
      <div className="graph-legend" aria-label="Edge legend">
        {level === 'symbol' ? (
          <>
            <span><i style={{ background: EDGE_COLORS.defines }} /> defines</span>
            <span><i style={{ background: EDGE_COLORS.calls }} /> calls</span>
            <span><i style={{ background: EDGE_COLORS.extends }} /> extends</span>
          </>
        ) : null}
        <span><i style={{ background: EDGE_COLORS.imports }} /> imports</span>
        {cyclePaths && cyclePaths.size > 0 ? (
          <span className="graph-legend__cycle"><i /> cycle</span>
        ) : null}
      </div>
      {visibleNodes.length > 700 ? (
        <div className="graph-lod-note">
          Large graph — zoom in for detail. Labels may be simplified at this scale.
        </div>
      ) : null}
    </div>
  );
}

export const GraphCanvas = memo(function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
});
