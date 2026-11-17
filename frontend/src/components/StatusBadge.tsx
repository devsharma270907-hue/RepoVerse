import type { AnalysisStatus } from '@/api/types';
import { Badge } from './ui';

const STATUS_CONFIG: Record<
  AnalysisStatus,
  { label: string; tone: 'gray' | 'blue' | 'green' | 'amber' | 'red' }
> = {
  queued: { label: 'Queued', tone: 'gray' },
  fetching: { label: 'Fetching', tone: 'blue' },
  parsing: { label: 'Parsing', tone: 'blue' },
  building_graph: { label: 'Building graph', tone: 'amber' },
  done: { label: 'Done', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
};

export function StatusBadge({ status }: { status: AnalysisStatus }) {
  const config = STATUS_CONFIG[status] ?? { label: status, tone: 'gray' as const };
  return (
    <Badge tone={config.tone} className={status === 'done' ? 'badge--dot' : 'badge--pulse'}>
      {config.label}
    </Badge>
  );
}

export function statusLabel(status: AnalysisStatus): string {
  return STATUS_CONFIG[status]?.label ?? status;
}

export function SeverityBadge({ severity }: { severity: 'low' | 'medium' | 'high' }) {
  const tone = severity === 'high' ? 'red' : severity === 'medium' ? 'amber' : 'green';
  return <Badge tone={tone}>{severity}</Badge>;
}

export function RiskBadge({ risk }: { risk: 'low' | 'medium' | 'high' }) {
  const tone = risk === 'high' ? 'red' : risk === 'medium' ? 'amber' : 'blue';
  return <Badge tone={tone}>{risk} risk</Badge>;
}
