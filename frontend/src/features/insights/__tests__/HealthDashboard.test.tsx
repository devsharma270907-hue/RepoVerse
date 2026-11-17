import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { HealthPayload } from '@/api/types';
import { HealthDashboard } from '@/features/insights/HealthDashboard';

const payload: HealthPayload = {
  analysisId: 'a1',
  repoScore: 62,
  files: [
    {
      path: 'src/big.ts',
      score: 62,
      penalties: [
        {
          code: 'HIGH_COMPLEXITY',
          message: 'handle() has cyclomatic complexity 22 — consider simplifying',
          line: 41,
          symbol: 'handle',
        },
      ],
      metrics: {
        loc: 120,
        fanIn: 3,
        fanOut: 4,
        deadCodeCandidate: false,
        symbolCount: 5,
        maxComplexity: 22,
        avgComplexity: 6.4,
        deadSymbols: 0,
        instability: 0.57,
      },
    },
    {
      path: 'src/clean.ts',
      score: 100,
      penalties: [],
      metrics: {
        loc: 12,
        fanIn: 1,
        fanOut: 0,
        deadCodeCandidate: false,
        symbolCount: 1,
        maxComplexity: 1,
        avgComplexity: 1,
        deadSymbols: 0,
        instability: 0,
      },
    },
  ],
};

function setup() {
  const onLocate = vi.fn();
  const onExplain = vi.fn();
  render(
    <HealthDashboard
      data={payload}
      isLoading={false}
      error={null}
      onRetry={() => undefined}
      onLocate={onLocate}
      onExplain={onExplain}
    />
  );
  return { onLocate, onExplain };
}

describe('<HealthDashboard />', () => {
  it('shows the repo score, file count and finding totals', () => {
    setup();
    expect(screen.getByText('Codebase health')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Health score 62 out of 100/ })).toBeInTheDocument();
    expect(screen.getByText('files scored')).toBeInTheDocument();
    expect(screen.getByText('findings')).toBeInTheDocument();
  });

  it('expands a file to reveal its located findings', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /src\/big\.ts/i }));
    expect(screen.getByText(/cyclomatic complexity 22/)).toBeInTheDocument();
    expect(screen.getByText('L41')).toBeInTheDocument();
  });

  it('deep-links a finding to its symbol on the map', async () => {
    const { onLocate, onExplain } = setup();
    await userEvent.click(screen.getByRole('button', { name: /src\/big\.ts/i }));
    await userEvent.click(screen.getByRole('button', { name: 'show on map' }));
    expect(onLocate).toHaveBeenCalledWith('sym:src/big.ts#handle');

    await userEvent.click(screen.getByRole('button', { name: 'explain' }));
    expect(onExplain).toHaveBeenCalledWith('sym:src/big.ts#handle');
  });

  it('filters out clean files when requested', async () => {
    setup();
    await userEvent.click(screen.getByRole('checkbox', { name: /only files with findings/i }));
    expect(screen.queryByText('src/clean.ts')).not.toBeInTheDocument();
  });

  it('sorts by lowest score by default', () => {
    setup();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('src/big.ts');
  });

  it('renders a loading state', () => {
    render(
      <HealthDashboard
        data={undefined}
        isLoading
        error={null}
        onRetry={() => undefined}
        onLocate={() => undefined}
        onExplain={() => undefined}
      />
    );
    expect(screen.getAllByText('Scoring the codebase…').length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
