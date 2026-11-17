import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { refreshSession } from '@/api/client';
import type { Analysis, AnalysisStatus, AnalysisSummary } from '@/api/types';
import { TERMINAL_STATUSES } from '@/api/types';
import { tokenStore } from '@/auth/tokenStore';
import { env } from '@/lib/env';

interface AnalysisUpdateEvent {
  analysisId: string;
  repoId: string;
  status: string;
  progress: number;
  summary?: AnalysisSummary | null;
  error?: { code: string; message: string } | null;
}

function isStatus(value: string): value is AnalysisStatus {
  return (
    value === 'queued' ||
    value === 'fetching' ||
    value === 'parsing' ||
    value === 'building_graph' ||
    value === 'done' ||
    value === 'failed'
  );
}

/**
 * Real-time analysis progress.
 *
 * The socket is JWT-gated server-side and joined to a server-only room, so the
 * client cannot subscribe to another user's events. HTTP polling in the
 * workspace remains the fallback when sockets are unavailable.
 */
export function useAnalysisEvents(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let retried = false;

    const socket: Socket = io(env.apiBaseUrl, {
      autoConnect: false,
      withCredentials: true,
      auth: { token: tokenStore.get() ?? '' },
      transports: ['websocket', 'polling'],
    });

    const connect = async (): Promise<void> => {
      if (disposed) return;
      if (!tokenStore.get()) {
        try {
          await refreshSession();
        } catch {
          return;
        }
      }
      socket.auth = { token: tokenStore.get() ?? '' };
      socket.connect();
    };

    const handleUpdate = (event: AnalysisUpdateEvent): void => {
      if (!event || typeof event.analysisId !== 'string') return;
      if (!isStatus(event.status)) return;
      const status = event.status;

      queryClient.setQueryData<Analysis>(
        ['analysis', event.analysisId],
        (previous) => {
          if (!previous) return previous;
          const finished =
            status === 'done' || status === 'failed'
              ? new Date().toISOString()
              : previous.finishedAt;
          return {
            ...previous,
            status,
            progress: event.progress,
            summary: event.summary ?? previous.summary,
            error: event.error ?? null,
            finishedAt: finished,
          };
        }
      );

      if (TERMINAL_STATUSES.includes(status)) {
        void queryClient.invalidateQueries({
          queryKey: ['repo-analyses', event.repoId],
        });
        void queryClient.invalidateQueries({
          queryKey: ['repos'],
        });
        void queryClient.invalidateQueries({
          queryKey: ['graph', event.analysisId],
        });
        void queryClient.invalidateQueries({
          queryKey: ['tree', event.analysisId],
        });
        void queryClient.invalidateQueries({
          queryKey: ['health', event.analysisId],
        });
        void queryClient.invalidateQueries({
          queryKey: ['cycles', event.analysisId],
        });
        void queryClient.invalidateQueries({
          queryKey: ['pins', event.analysisId],
        });
      }
    };

    const handleConnectError = async (): Promise<void> => {
      if (disposed || retried) return;
      retried = true;
      try {
        await refreshSession();
        socket.auth = { token: tokenStore.get() ?? '' };
        socket.connect();
      } catch {
        // Polling fallback keeps the UI functional.
      }
    };

    socket.on('analysis:update', handleUpdate);
    socket.on('connect_error', handleConnectError);
    void connect();

    return () => {
      disposed = true;
      socket.off('analysis:update', handleUpdate);
      socket.off('connect_error', handleConnectError);
      socket.disconnect();
    };
  }, [enabled, queryClient]);
}
