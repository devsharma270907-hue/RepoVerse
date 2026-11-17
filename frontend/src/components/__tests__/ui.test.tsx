import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  ErrorNotice,
  ProgressBar,
  ScoreRing,
  Tabs,
  Toggle,
} from '@/components/ui';
import { StatusBadge, statusLabel } from '@/components/StatusBadge';

describe('<Button />', () => {
  it('renders children and forwards clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Analyze</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables while loading and shows a spinner', () => {
    render(<Button loading>Working</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button').querySelector('.spinner')).not.toBeNull();
  });

  it('applies variant classes', () => {
    render(<Button variant="primary">Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn', 'btn--primary');
  });
});

describe('<Tabs />', () => {
  it('marks the active tab and emits changes', async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        tabs={[
          { id: 'map', label: 'Map' },
          { id: 'health', label: 'Health', count: 3 },
        ]}
        value="map"
        onChange={onChange}
      />
    );

    const mapTab = screen.getByRole('tab', { name: /map/i });
    expect(mapTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /health/i }));
    expect(onChange).toHaveBeenCalledWith('health');
  });
});

describe('<ScoreRing />', () => {
  it('clamps the score and exposes an accessible label', () => {
    render(<ScoreRing score={140} label="health" />);
    expect(screen.getByRole('img', { name: 'Health score 100 out of 100' })).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });
});

describe('<ProgressBar />', () => {
  it('clamps width between 0 and 100', () => {
    const { container } = render(<ProgressBar value={-20} />);
    expect(container.querySelector('.progress__bar')).toHaveStyle({ width: '0%' });
  });
});

describe('<Toggle />', () => {
  it('is a switch that reports its state', async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Dark theme" />);
    const toggle = screen.getByRole('switch', { name: 'Dark theme' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('feedback surfaces', () => {
  it('renders friendly error copy with a retry', async () => {
    const onRetry = vi.fn();
    render(
      <ErrorNotice
        error={{ code: 'REPO_TOO_LARGE', message: 'raw' }}
        onRetry={onRetry}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/REPO TOO LARGE/i);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('labels analysis statuses', () => {
    render(<StatusBadge status="building_graph" />);
    expect(screen.getByText('Building graph')).toBeInTheDocument();
    expect(statusLabel('done')).toBe('Done');
  });

  it('renders a badge', () => {
    render(<Badge tone="violet">impact</Badge>);
    expect(screen.getByText('impact')).toHaveClass('badge--violet');
  });
});
