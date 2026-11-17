import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { GraphNode } from '@/api/types';

export type WorkspaceView = 'map' | 'health' | 'cycles';

export interface WorkspacePaletteSource {
  analysisId: string;
  nodes: GraphNode[];
  onSelectNode: (key: string) => void;
  onExplainNode: (key: string) => void;
  onSetView: (view: WorkspaceView) => void;
  selectedKey: string | null;
}

interface PaletteOpenOptions {
  prefill?: string;
  mode?: 'jump' | 'ai';
}

interface PaletteContextValue {
  open: boolean;
  paletteState: PaletteOpenOptions | null;
  openPalette: (options?: PaletteOpenOptions) => void;
  closePalette: () => void;
  workspace: WorkspacePaletteSource | null;
  setWorkspace: (source: WorkspacePaletteSource | null) => void;
}

const PaletteContext = createContext<PaletteContextValue | null>(null);

export function PaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [paletteState, setPaletteState] = useState<PaletteOpenOptions | null>(null);
  const [workspace, setWorkspace] = useState<WorkspacePaletteSource | null>(null);

  const openPalette = useCallback((options: PaletteOpenOptions = {}) => {
    setPaletteState({ mode: 'jump', ...options });
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => setOpen(false), []);

  // Global ⌘K / Ctrl+K.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteState({ mode: 'jump' });
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const value = useMemo<PaletteContextValue>(
    () => ({
      open,
      paletteState,
      openPalette,
      closePalette,
      workspace,
      setWorkspace,
    }),
    [open, paletteState, openPalette, closePalette, workspace]
  );

  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

export function usePalette(): PaletteContextValue {
  const context = useContext(PaletteContext);
  if (!context) throw new Error('usePalette must be used inside <PaletteProvider>');
  return context;
}
