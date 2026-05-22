import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type ToastVariant = 'success' | 'error' | 'warn' | 'info';

export interface ToastInput {
  title: string;
  /** Optional secondary line. Hex strings and longer explanations go here. */
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss in ms. Defaults: success 3500, info 4000, warn 6000, error sticky (0). 0 disables auto-dismiss. */
  durationMs?: number;
  /** Optional action button — rendered inline. */
  action?: { label: string; onClick: () => void };
}

export interface Toast extends ToastInput {
  id: number;
  variant: ToastVariant;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
  success: (title: string, description?: string) => number;
  error: (title: string, description?: string) => number;
  warn: (title: string, description?: string) => number;
  info: (title: string, description?: string) => number;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 3500,
  info:    4000,
  warn:    6000,
  error:   0, // sticky until dismissed
};

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((input: ToastInput): number => {
    const id = nextId.current++;
    const variant = input.variant ?? 'info';
    const duration = input.durationMs ?? DEFAULT_DURATION[variant];
    setToasts((prev) => [...prev, { ...input, id, variant }]);
    if (duration > 0) {
      window.setTimeout(() => dismiss(id), duration);
    }
    return id;
  }, [dismiss]);

  const value = useMemo<ToastContextValue>(() => ({
    toasts,
    push,
    dismiss,
    success: (title, description) => push({ title, description, variant: 'success' }),
    error:   (title, description) => push({ title, description, variant: 'error' }),
    warn:    (title, description) => push({ title, description, variant: 'warn' }),
    info:    (title, description) => push({ title, description, variant: 'info' }),
  }), [toasts, push, dismiss]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
