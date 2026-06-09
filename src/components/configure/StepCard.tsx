import type { StepStatus } from './types';
import { StatusIcon } from '../Icon';
import { Spinner } from '../Spinner';

interface Props {
  n: number;
  title: string;
  subtitle: string;
  status: StepStatus;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function statusBadge(status: StepStatus): React.ReactNode {
  const homeDone = status.home === 'configured';
  const remoteDone = status.remote === 'configured';
  const anyPending = status.home === 'pending' || status.remote === 'pending';
  const anyError = status.home === 'error' || status.remote === 'error';

  if (anyPending) return <Spinner size="sm" className="text-primary" />;
  if (anyError) return <StatusIcon kind="error" size={15} />;
  if (homeDone && remoteDone) return <StatusIcon kind="success" size={15} />;
  if (homeDone || remoteDone) return <span className="text-[11px] text-warn font-bold">½</span>;
  return null;
}

export function StepCard({ n, title, subtitle, status, open, onToggle, children }: Props): JSX.Element {
  const allDone = status.home === 'configured' && status.remote === 'configured';

  return (
    <div className={`step-card${open ? ' step-card-open' : ''}`}
      style={allDone && !open ? { borderColor: 'rgba(105, 246, 184, 0.15)' } : undefined}>
      <button className="step-header" onClick={onToggle}>
        <span className={`step-num${allDone ? ' step-num-done' : ''}`}
          style={allDone ? { background: 'rgba(105, 246, 184, 0.1)', borderColor: 'rgba(105, 246, 184, 0.3)', color: 'var(--secondary)' } : undefined}>
          {allDone ? '✓' : n}
        </span>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</div>
        </div>
        {statusBadge(status)}
        <span style={{ color: 'var(--text-dim)', fontSize: 12, marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="step-body">{children}</div>}
    </div>
  );
}
