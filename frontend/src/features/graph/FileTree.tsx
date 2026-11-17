import { useEffect, useMemo, useState } from 'react';
import type { GraphTree, TreeNode } from '@/api/types';
import { Icon } from '@/components/Icon';

function collectDirPaths(node: TreeNode, accumulator: Set<string>): void {
  if (node.type !== 'dir') return;
  if (node.path) accumulator.add(node.path);
  for (const child of node.children ?? []) collectDirPaths(child, accumulator);
}

function nodeMatches(node: TreeNode, query: string): boolean {
  if (!query) return true;
  if (node.path.toLowerCase().includes(query) || node.name.toLowerCase().includes(query)) {
    return true;
  }
  return (node.children ?? []).some((child) => nodeMatches(child, query));
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  selectedPath,
  onSelectFile,
  query,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  query: string;
}) {
  if (!nodeMatches(node, query)) return null;

  if (node.type === 'dir') {
    const isOpen = expanded.has(node.path) || Boolean(query);
    const children = (node.children ?? []).filter((child) => nodeMatches(child, query));
    return (
      <li>
        <button
          type="button"
          className="tree__row tree__row--dir"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => onToggle(node.path)}
          aria-expanded={isOpen}
        >
          <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={13} />
          <Icon name="folder" size={15} className="tree__icon tree__icon--dir" />
          <span className="tree__name">{node.name}</span>
          <span className="tree__meta">{children.length}</span>
        </button>
        {isOpen ? (
          <ul className="tree__list">
            {children.map((child) => (
              <TreeRow
                key={child.path || child.name}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                query={query}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  const selected = selectedPath === node.path;
  return (
    <li>
      <button
        type="button"
        className={['tree__row', 'tree__row--file', selected ? 'tree__row--selected' : '']
          .filter(Boolean)
          .join(' ')}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelectFile(node.path)}
        title={node.path}
      >
        <span className="tree__spacer" />
        <Icon name="file" size={14} className="tree__icon" />
        <span className="tree__name">{node.name}</span>
        <span className="tree__meta">
          {typeof node.symbolCount === 'number' ? node.symbolCount : node.loc ?? 0}
        </span>
      </button>
    </li>
  );
}

export function FileTree({
  tree,
  selectedPath,
  onSelectFile,
  query,
}: {
  tree: GraphTree;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  query: string;
}) {
  const allDirs = useMemo(() => {
    const accumulator = new Set<string>();
    collectDirPaths(tree.root, accumulator);
    return accumulator;
  }, [tree]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allDirs));

  // A new analysis resets expansion to "everything open".
  useEffect(() => {
    setExpanded(new Set(allDirs));
  }, [allDirs]);

  const toggle = (path: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const files = useMemo(() => {
    const list: string[] = [];
    const walk = (node: TreeNode): void => {
      if (node.type === 'file') list.push(node.path);
      else for (const child of node.children ?? []) walk(child);
    };
    walk(tree.root);
    return list;
  }, [tree]);

  const visibleFiles = query
    ? files.filter((path) => path.toLowerCase().includes(query.toLowerCase()))
    : files;

  return (
    <div className="tree">
      <div className="tree__summary">
        <span>{tree.fileCount} files</span>
        {query ? <span>{visibleFiles.length} matching</span> : null}
      </div>
      <ul className="tree__list tree__list--root">
        {(tree.root.children ?? []).map((child) => (
          <TreeRow
            key={child.path || child.name}
            node={child}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            query={query}
          />
        ))}
      </ul>
      {visibleFiles.length === 0 ? (
        <p className="tree__empty">No files match “{query}”.</p>
      ) : null}
    </div>
  );
}
