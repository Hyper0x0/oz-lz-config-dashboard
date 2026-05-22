import { useState } from 'react';

interface Props {
  value: string;
  /** Show "Copied" feedback for this many ms before reverting. */
  feedbackMs?: number;
  /** Override default button classes. */
  className?: string;
  /** Optional label rendered next to the icon. Icon-only by default. */
  label?: string;
  /** ARIA / tooltip text. */
  title?: string;
}

/** One-click clipboard copy with brief visual confirmation. */
export function CopyButton({ value, feedbackMs = 1200, className, label, title }: Props): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), feedbackMs);
    } catch {
      // Permission denied / insecure context — silently no-op; users can still
      // select the text manually.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={className ?? 'btn btn-sm btn-ghost'}
      title={title ?? (copied ? 'Copied' : 'Copy to clipboard')}
      aria-label={title ?? 'Copy to clipboard'}
    >
      <span className="material-symbols-outlined text-sm">
        {copied ? 'check' : 'content_copy'}
      </span>
      {label && <span>{copied ? 'Copied' : label}</span>}
    </button>
  );
}
