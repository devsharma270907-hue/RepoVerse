import type { ReactNode } from 'react';
import { Button, ErrorNotice } from './ui';

/** Standard loading/error wrapper for query-backed panels. */
export function QueryState({
  isLoading,
  error,
  onRetry,
  children,
  loadingLabel = 'Loading…',
  compact = false,
}: {
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  children: ReactNode;
  loadingLabel?: string;
  compact?: boolean;
}) {
  if (isLoading) {
    return (
      <div className={compact ? 'loading-block loading-block--compact' : 'loading-block'}>
        <span className="spinner" aria-hidden="true" />
        <span>{loadingLabel}</span>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorNotice
        error={{
          code: 'REQUEST_FAILED',
          message: error instanceof Error ? error.message : 'Request failed',
        }}
        onRetry={onRetry}
        compact={compact}
      />
    );
  }

  return <>{children}</>;
}

export function InlineRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <Button size="sm" variant="ghost" icon="refresh" onClick={onRetry}>
      Try again
    </Button>
  );
}
