import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listRepos } from '@/api/endpoints';
import { queryKeys, useSmartSearchMutation } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { Kbd } from '@/components/ui';
import { friendlyMessage, toAppError } from '@/lib/errors';
import { env } from '@/lib/env';
import { useTheme } from '@/lib/theme';
import { usePalette } from './PaletteProvider';

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: IconName;
  keywords?: string;
  run: () => void;
}

export function CommandPalette() {
  const { open, paletteState, closePalette, workspace } = usePalette();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { theme, toggle } = useTheme();

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useSmartSearchMutation(workspace?.analysisId ?? '');

  const reposQuery = useQuery({
    queryKey: queryKeys.repos(1),
    queryFn: () => listRepos(1, 8),
    enabled: open && !workspace,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    setQuery(paletteState?.prefill ?? '');
    setActive(0);
    search.reset();
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previous;
    };
    // Reset only when the palette transitions to open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const item = document.getElementById(`palette-item-${active}`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const runAi = (value: string): void => {
    if (!workspace || value.trim().length < 3) return;
    search.mutate(value.trim());
    setActive(0);
  };

  const items = useMemo<PaletteItem[]>(() => {
    const trimmed = query.trim();
    const lowered = trimmed.toLowerCase();
    const result: PaletteItem[] = [];

    const aiResults = env.enableSmartSearch ? (search.data?.results ?? []) : [];
    for (const hit of aiResults) {
      result.push({
        id: `ai:${hit.nodeKey}`,
        group: 'AI results',
        label: hit.name ?? hit.path ?? hit.nodeKey,
        hint: hit.why,
        icon: 'sparkles',
        run: () => {
          workspace?.onSelectNode(hit.nodeKey);
          closePalette();
        },
      });
    }

    if (workspace && env.enableSmartSearch && trimmed.length >= 3) {
      result.push({
        id: 'ask-ai',
        group: 'Actions',
        label: `Ask AI: “${trimmed}”`,
        hint: 'rank files and symbols with Smart Search',
        icon: 'sparkles',
        run: () => runAi(trimmed),
      });
    }

    if (workspace) {
      result.push(
        {
          id: 'view-map',
          group: 'Workspace',
          label: 'Open dependency map',
          icon: 'graph',
          run: () => {
            workspace.onSetView('map');
            closePalette();
          },
        },
        {
          id: 'view-health',
          group: 'Workspace',
          label: 'Open health dashboard',
          icon: 'health',
          run: () => {
            workspace.onSetView('health');
            closePalette();
          },
        },
        {
          id: 'view-cycles',
          group: 'Workspace',
          label: 'Open cycles dashboard',
          icon: 'cycle',
          run: () => {
            workspace.onSetView('cycles');
            closePalette();
          },
        }
      );

      if (workspace.selectedKey) {
        result.push({
          id: 'explain-selected',
          group: 'Workspace',
          label: 'Explain selected node',
          hint: workspace.selectedKey,
          icon: 'sparkles',
          run: () => {
            workspace.onExplainNode(workspace.selectedKey as string);
            closePalette();
          },
        });
      }

      const nodeMatches = workspace.nodes
        .filter((node) => {
          if (!trimmed) return node.kind !== 'repo';
          const haystack = `${node.name ?? ''} ${node.path ?? ''} ${node.id}`.toLowerCase();
          return haystack.includes(lowered);
        })
        .sort((a, b) => {
          const aName = (a.name ?? a.path ?? '').toLowerCase();
          const bName = (b.name ?? b.path ?? '').toLowerCase();
          const aStarts = aName.startsWith(lowered) ? 0 : 1;
          const bStarts = bName.startsWith(lowered) ? 0 : 1;
          return aStarts - bStarts || b.fanIn - a.fanIn || aName.localeCompare(bName);
        })
        .slice(0, 8);

      for (const node of nodeMatches) {
        result.push({
          id: `node:${node.id}`,
          group: 'Files & symbols',
          label: node.name ?? node.path ?? node.id,
          hint: node.path ?? node.id,
          icon: node.kind === 'file' ? 'file' : node.kind === 'class' ? 'layers' : 'code',
          run: () => {
            workspace.onSelectNode(node.id);
            closePalette();
          },
        });
      }
    }

    result.push(
      {
        id: 'nav-repos',
        group: 'Navigate',
        label: 'Go to repositories',
        icon: 'repo',
        run: () => {
          navigate('/');
          closePalette();
        },
      },
      {
        id: 'nav-settings',
        group: 'Navigate',
        label: 'Go to settings',
        icon: 'settings',
        run: () => {
          navigate('/settings');
          closePalette();
        },
      },
      {
        id: 'toggle-theme',
        group: 'Preferences',
        label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
        icon: theme === 'dark' ? 'sun' : 'moon',
        run: () => {
          toggle();
          closePalette();
        },
      },
      {
        id: 'logout',
        group: 'Preferences',
        label: 'Log out',
        icon: 'logout',
        run: () => {
          closePalette();
          void logout().then(() => navigate('/login'));
        },
      }
    );

    if (!workspace && reposQuery.data) {
      for (const repo of reposQuery.data.repos) {
        if (trimmed && !`${repo.owner}/${repo.name}`.toLowerCase().includes(lowered)) continue;
        result.push({
          id: `repo:${repo.id}`,
          group: 'Repositories',
          label: `${repo.owner}/${repo.name}`,
          hint: repo.isPrivate ? 'private' : repo.branch,
          icon: 'repo',
          run: () => {
            navigate(`/repos/${repo.id}`);
            closePalette();
          },
        });
      }
    }

    return result;
  }, [query, search.data, workspace, theme, toggle, navigate, logout, closePalette, reposQuery.data]);

  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(items.length - 1, 0)));
  }, [items.length]);

  if (!open) return null;

  const error = search.error ? toAppError(search.error) : null;
  const groups = items.reduce<Record<string, Array<{ item: PaletteItem; index: number }>>>(
    (accumulator, item, index) => {
      accumulator[item.group] ??= [];
      accumulator[item.group].push({ item, index });
      return accumulator;
    },
    {}
  );

  const execute = (item: PaletteItem | undefined): void => {
    if (!item) return;
    item.run();
  };

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && closePalette()}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette__input-row">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            className="palette__input"
            placeholder={
              workspace
                ? 'Jump to a file or symbol, or ask “where is auth handled?”…'
                : 'Search repositories and actions…'
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              if (search.data) search.reset();
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, items.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                execute(items[active]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                closePalette();
              }
            }}
            aria-activedescendant={items[active] ? `palette-item-${active}` : undefined}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
          />
          {search.isPending ? <span className="spinner spinner--sm" aria-label="Searching" /> : null}
          <Kbd>esc</Kbd>
        </div>

        {error ? (
          <div className="palette__error" role="alert">
            <Icon name="alert" size={15} />
            <span>{friendlyMessage(error)}</span>
          </div>
        ) : null}

        <div className="palette__list" id="palette-list" role="listbox">
          {items.length === 0 ? (
            <p className="palette__empty">No matches. Try a different query.</p>
          ) : (
            Object.entries(groups).map(([group, entries]) => (
              <section key={group} className="palette__group">
                <h3>{group}</h3>
                {entries.map(({ item, index }) => (
                  <button
                    key={item.id}
                    id={`palette-item-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    className={['palette__item', index === active ? 'palette__item--active' : '']
                      .filter(Boolean)
                      .join(' ')}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => execute(item)}
                  >
                    <span className="palette__icon">
                      <Icon name={item.icon} size={16} />
                    </span>
                    <span className="palette__text">
                      <span className="palette__label">{item.label}</span>
                      {item.hint ? <span className="palette__hint">{item.hint}</span> : null}
                    </span>
                    {index === active ? <Kbd>↵</Kbd> : null}
                  </button>
                ))}
              </section>
            ))
          )}
        </div>

        <footer className="palette__footer">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span>
            {workspace ? 'Jump or ask — results are grounded in this analysis.' : 'Global commands'}
          </span>
        </footer>
      </div>
    </div>
  );
}
