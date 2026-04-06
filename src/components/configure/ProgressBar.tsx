import type { StepDef, StepStatus, StepId } from './types';

interface Props {
  steps: StepDef[];
  statuses: Record<StepId, StepStatus>;
}

function isDone(s: StepStatus): boolean {
  return s.home === 'configured' && s.remote === 'configured';
}

export function ProgressBar({ steps, statuses }: Props): JSX.Element {
  const visible = steps.filter((s) => s.visible);
  const doneCount = visible.filter((s) => isDone(statuses[s.id])).length;
  const allDone = doneCount === visible.length;

  return (
    <div className="flex items-center gap-3 mb-4 px-1">
      <div className="flex gap-1.5">
        {visible.map((s) => {
          const done = isDone(statuses[s.id]);
          const anyPending = statuses[s.id].home === 'pending' || statuses[s.id].remote === 'pending';
          return (
            <span
              key={s.id}
              title={s.title}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                done ? 'bg-[var(--secondary)]' :
                anyPending ? 'bg-[var(--accent)] animate-pulse' :
                'bg-[var(--border)]'
              }`}
            />
          );
        })}
      </div>
      <span className={`text-[11px] font-mono ${allDone ? 'text-[var(--secondary)]' : 'text-[var(--text-muted)]'}`}>
        {doneCount}/{visible.length} {allDone ? 'complete ✓' : 'done'}
      </span>
    </div>
  );
}
