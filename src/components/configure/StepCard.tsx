import type { StepStatus } from './types';
import { Icon, StatusIcon, ICONS } from '../Icon';
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
    <div className={`step-card${open ? ' step-card-open' : ''}${allDone && !open ? ' step-card-done' : ''}`}>
      <button className="step-header" onClick={onToggle}>
        <span className={`step-num${allDone ? ' step-num-done' : ''}`}>
          {allDone ? <Icon name={ICONS.check} size={14} /> : n}
        </span>
        <div className="flex-1 text-left">
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-on-surface-variant">{subtitle}</div>
        </div>
        {statusBadge(status)}
        <Icon name={open ? 'expand_less' : 'expand_more'} size={18} className="text-on-surface-variant ml-2" />
      </button>
      {open && <div className="step-body">{children}</div>}
    </div>
  );
}
