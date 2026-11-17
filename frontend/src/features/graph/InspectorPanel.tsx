import { useState } from 'react';
import type { GraphNodeKind, Neighbour, Pin } from '@/api/types';
import { useCallers, useNodeDetail } from '@/api/hooks';
import { Icon } from '@/components/Icon';
import { Badge, Button, CopyButton, EmptyState, ErrorNotice, MetaList, Spinner } from '@/components/ui';
import { filePathOfKey, labelOfKey, symbolNameOfKey } from '@/lib/nodeKey';

const KIND_TONE: Record<GraphNodeKind, 'gray' | 'blue' | 'violet' | 'cyan' | 'green'> = {
  repo: 'gray',
  file: 'blue',
  class: 'violet',
  function: 'cyan',
  method: 'green',
};

function NeighbourList({
  title,
  caption,
  items,
  emptyLabel,
  onSelect,
}: {
  title: string;
  caption: string;
  items: Neighbour[];
  emptyLabel: string;
  onSelect: (key: string) => void;
}) {
  return (
    <section className="inspector__section">
      <header className="inspector__section-head">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </header>
      <p className="inspector__caption">{caption}</p>
      {items.length === 0 ? (
        <p className="inspector__empty">{emptyLabel}</p>
      ) : (
        <ul className="neighbour-list">
          {items.map((item) => (
            <li key={`${item.key}-${item.edgeKind ?? ''}`}>
              <button type="button" className="neighbour" onClick={() => onSelect(item.key)}>
                <span className="neighbour__main">
                  <span className="neighbour__name">{item.name ?? labelOfKey(item.key)}</span>
                  <span className="neighbour__path">{item.path ?? item.key}</span>
                </span>
                <span className="neighbour__side">
                  {item.edgeKind ? <Badge tone="gray">{item.edgeKind}</Badge> : null}
                  {item.loc ? <span className="neighbour__loc">L{item.loc}</span> : null}
                  <Icon name="chevron-right" size={13} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function InspectorPanel({
  analysisId,
  selectedKey,
  onSelectNode,
  onExplain,
  onImpact,
  impactEnabled,
  pins,
  onPin,
  onDeletePin,
  pinPending,
  onSelectPinned,
}: {
  analysisId: string;
  selectedKey: string | null;
  onSelectNode: (key: string) => void;
  onExplain: (key: string) => void;
  onImpact: () => void;
  impactEnabled: boolean;
  pins: Pin[];
  onPin: (nodeKey: string, note: string) => Promise<void>;
  onDeletePin: (pinId: string) => void;
  pinPending: boolean;
  onSelectPinned: (key: string) => void;
}) {
  const nodeQuery = useNodeDetail(analysisId, selectedKey);
  const [note, setNote] = useState('');
  const [showCallers, setShowCallers] = useState(false);
  const [callerDepth, setCallerDepth] = useState(2);
  const callersQuery = useCallers(analysisId, selectedKey, callerDepth, showCallers);

  if (!selectedKey) {
    return (
      <div className="inspector">
        <EmptyState
          icon="impact"
          title="Select a node"
          description="Click any file or symbol on the map to inspect its source location, call sites and dependencies."
        />
        {pins.length > 0 ? (
          <section className="inspector__section">
            <header className="inspector__section-head">
              <h3>Pinned findings</h3>
              <span>{pins.length}</span>
            </header>
            <ul className="pin-list">
              {pins.map((pin) => (
                <li key={pin.id}>
                  <button type="button" className="pin" onClick={() => onSelectPinned(pin.nodeKey)}>
                    <Icon name="pin" size={14} />
                    <span>
                      <strong>{labelOfKey(pin.nodeKey)}</strong>
                      {pin.note ? <em>{pin.note}</em> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  const node = nodeQuery.data?.node;
  const kind = node?.kind;
  const isSymbol = selectedKey.startsWith('sym:');
  const nodePins = pins.filter((pin) => pin.nodeKey === selectedKey);

  return (
    <div className="inspector">
      <header className="inspector__header">
        <div className="inspector__title">
          <span className="inspector__eyebrow">{kind ? <Badge tone={KIND_TONE[kind]}>{kind}</Badge> : 'node'}</span>
          <h2 title={selectedKey}>{symbolNameOfKey(selectedKey) ?? filePathOfKey(selectedKey) ?? selectedKey}</h2>
          <p className="inspector__key">{selectedKey}</p>
        </div>
        <CopyButton text={selectedKey} label="Key" />
      </header>

      <div className="inspector__actions">
        <Button size="sm" variant="primary" icon="sparkles" onClick={() => onExplain(selectedKey)}>
          Explain
        </Button>
        <Button
          size="sm"
          variant={impactEnabled ? 'success' : 'secondary'}
          icon="impact"
          onClick={onImpact}
        >
          {impactEnabled ? 'Impact on' : 'Impact'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="pin"
          loading={pinPending}
          onClick={() => {
            void onPin(selectedKey, note).then(() => setNote(''));
          }}
        >
          Pin
        </Button>
      </div>

      <div className="inspector__pin-form">
        <input
          className="input input--sm"
          placeholder="Optional note for this pin…"
          value={note}
          maxLength={280}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void onPin(selectedKey, note).then(() => setNote(''));
            }
          }}
        />
      </div>

      {nodeQuery.isLoading ? (
        <div className="loading-block loading-block--compact">
          <Spinner /> Loading node…
        </div>
      ) : nodeQuery.error ? (
        <ErrorNotice
          error={{
            code: 'NODE_UNAVAILABLE',
            message:
              nodeQuery.error instanceof Error
                ? nodeQuery.error.message
                : 'Could not load this node.',
          }}
          onRetry={() => void nodeQuery.refetch()}
          compact
        />
      ) : node ? (
        <>
          <MetaList
            items={[
              { label: 'Path', value: node.path ?? '—' },
              { label: 'Lines', value: node.loc ? `${node.loc}${node.endLine ? `–${node.endLine}` : ''}` : '—' },
              { label: 'Exported', value: node.exported === null ? '—' : node.exported ? 'yes' : 'no' },
              { label: 'Fan-in', value: node.fanIn },
              { label: 'Fan-out', value: node.fanOut },
              {
                label: 'Complexity',
                value: node.complexity !== null ? node.complexity : '—',
              },
              {
                label: 'Parameters',
                value: node.paramCount !== null ? node.paramCount : '—',
              },
            ]}
          />

          <NeighbourList
            title="Incoming"
            caption={isSymbol ? 'Who calls this symbol.' : 'Files that import this file.'}
            items={nodeQuery.data?.incoming ?? []}
            emptyLabel={isSymbol ? 'Nothing calls this symbol.' : 'Nothing imports this file.'}
            onSelect={onSelectNode}
          />

          <NeighbourList
            title="Outgoing"
            caption={isSymbol ? 'What this symbol calls.' : 'Files this file imports.'}
            items={nodeQuery.data?.outgoing ?? []}
            emptyLabel={isSymbol ? 'This symbol calls nothing tracked.' : 'No tracked imports.'}
            onSelect={onSelectNode}
          />

          {isSymbol ? (
            <section className="inspector__section">
              <header className="inspector__section-head">
                <h3>Callers</h3>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setShowCallers((value) => !value)}
                >
                  {showCallers ? 'Hide' : 'Reverse traversal'}
                </button>
              </header>
              {showCallers ? (
                <>
                  <div className="inspector__inline-controls">
                    <label htmlFor="caller-depth">Depth</label>
                    <select
                      id="caller-depth"
                      className="select select--sm"
                      value={callerDepth}
                      onChange={(event) => setCallerDepth(Number(event.target.value))}
                    >
                      {[1, 2, 3, 4, 5].map((depth) => (
                        <option key={depth} value={depth}>
                          {depth}
                        </option>
                      ))}
                    </select>
                  </div>
                  {callersQuery.isLoading ? (
                    <div className="loading-block loading-block--compact">
                      <Spinner /> Traversing calls…
                    </div>
                  ) : callersQuery.error ? (
                    <p className="inspector__empty">Caller traversal unavailable.</p>
                  ) : callersQuery.data && callersQuery.data.callers.length > 0 ? (
                    <ul className="neighbour-list">
                      {callersQuery.data.callers.map((caller) => (
                        <li key={caller.key}>
                          <button
                            type="button"
                            className="neighbour"
                            onClick={() => onSelectNode(caller.key)}
                          >
                            <span className="neighbour__main">
                              <span className="neighbour__name">{caller.name ?? labelOfKey(caller.key)}</span>
                              <span className="neighbour__path">{caller.path ?? caller.key}</span>
                            </span>
                            <span className="neighbour__side">
                              <Badge tone="blue">depth {caller.depth}</Badge>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="inspector__empty">No upstream callers.</p>
                  )}
                </>
              ) : (
                <p className="inspector__caption">
                  Follow reverse `calls` edges up to 5 levels to find indirect callers.
                </p>
              )}
            </section>
          ) : null}

          {nodePins.length > 0 ? (
            <section className="inspector__section">
              <header className="inspector__section-head">
                <h3>Pins on this node</h3>
                <span>{nodePins.length}</span>
              </header>
              <ul className="pin-list">
                {nodePins.map((pin) => (
                  <li key={pin.id}>
                    <div className="pin pin--static">
                      <Icon name="pin" size={14} />
                      <span>{pin.note ?? 'No note'}</span>
                      <button
                        type="button"
                        className="link-button link-button--danger"
                        onClick={() => onDeletePin(pin.id)}
                      >
                        remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
