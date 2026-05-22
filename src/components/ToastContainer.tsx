import { useToast } from '@/context/ToastContext';
import type { Toast, ToastVariant } from '@/context/ToastContext';

const ICONS: Record<ToastVariant, string> = {
  success: 'check_circle',
  error:   'error',
  warn:    'warning',
  info:    'info',
};

/** Fixed top-right stack. Mounted once at the app root via ToastProvider. */
export function ToastContainer(): JSX.Element | null {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }): JSX.Element {
  return (
    <div className={`toast toast-${toast.variant}`}>
      <span className={`material-symbols-outlined toast-icon toast-icon-${toast.variant}`}>{ICONS[toast.variant]}</span>
      <div className="toast-body">
        <div className="toast-title">{toast.title}</div>
        {toast.description && <div className="toast-desc">{toast.description}</div>}
        {toast.action && (
          <button type="button" className="toast-action" onClick={toast.action.onClick}>
            {toast.action.label}
          </button>
        )}
      </div>
      <button type="button" className="toast-close" onClick={onDismiss} aria-label="Dismiss">
        <span className="material-symbols-outlined text-sm">close</span>
      </button>
    </div>
  );
}
