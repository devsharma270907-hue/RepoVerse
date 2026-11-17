import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { friendlyMessage } from '@/lib/errors';
import type { AppError } from '@/lib/errors';

/* ── Buttons ──────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={['btn', `btn--${variant}`, `btn--${size}`, className]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="spinner spinner--sm" aria-hidden="true" />
      ) : icon ? (
        <Icon name={icon} size={size === 'sm' ? 15 : 17} />
      ) : null}
      {children ? <span>{children}</span> : null}
      {iconRight ? <Icon name={iconRight} size={size === 'sm' ? 15 : 17} /> : null}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={['btn', 'btn--icon', `btn--${variant}`, `btn--${size}`, className]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 15 : 18} />
    </button>
  );
}

/* ── Form controls ────────────────────────────────────────────────────── */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={['input', className].filter(Boolean).join(' ')} {...rest} />;
  }
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={['input', 'input--textarea', className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
});

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  optional?: boolean;
}

export function Field({ label, htmlFor, hint, error, children, optional }: FieldProps) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {optional ? <span className="field__optional">optional</span> : null}
      </label>
      {children}
      {error ? (
        <p className="field__error" role="alert">
          <Icon name="alert" size={13} /> {error}
        </p>
      ) : hint ? (
        <p className="field__hint">{hint}</p>
      ) : null}
    </div>
  );
}

/* ── Surfaces ─────────────────────────────────────────────────────────── */

export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}

export function Card({ title, subtitle, actions, children, className, flush }: CardProps) {
  return (
    <section className={['card', className].filter(Boolean).join(' ')}>
      {(title || actions) && (
        <header className="card__header">
          <div>
            {title ? <h2 className="card__title">{title}</h2> : null}
            {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="card__actions">{actions}</div> : null}
        </header>
      )}
      <div className={['card__body', flush ? 'card__body--flush' : ''].filter(Boolean).join(' ')}>
        {children}
      </div>
    </section>
  );
}

type BadgeTone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'cyan';

export function Badge({
  tone = 'gray',
  children,
  icon,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  icon?: IconName;
  className?: string;
}) {
  return (
    <span className={['badge', `badge--${tone}`, className].filter(Boolean).join(' ')}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

/* ── Feedback ─────────────────────────────────────────────────────────── */

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      {label ? <span className="spinner-wrap__label">{label}</span> : null}
      <span className="sr-only">{label ?? 'Loading'}</span>
    </span>
  );
}

export function EmptyState({
  icon = 'info',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name={icon} size={26} />
      </span>
      <h3 className="empty__title">{title}</h3>
      {description ? <p className="empty__description">{description}</p> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

export function ErrorNotice({
  error,
  onRetry,
  compact,
}: {
  error: AppError | null;
  onRetry?: () => void;
  compact?: boolean;
}) {
  if (!error) return null;
  return (
    <div className={['error-notice', compact ? 'error-notice--compact' : ''].filter(Boolean).join(' ')} role="alert">
      <Icon name="alert" size={18} />
      <div className="error-notice__body">
        <strong>{error.code.replaceAll('_', ' ')}</strong>
        <p>{friendlyMessage(error)}</p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="ghost" icon="refresh" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/* ── Navigation ───────────────────────────────────────────────────────── */

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
  count?: number;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: Array<TabItem<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          className={['tab', value === tab.id ? 'tab--active' : ''].filter(Boolean).join(' ')}
          onClick={() => onChange(tab.id)}
        >
          {tab.icon ? <Icon name={tab.icon} size={15} /> : null}
          {tab.label}
          {typeof tab.count === 'number' ? <span className="tab__count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ── Overlays ─────────────────────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={['modal', `modal--${size}`].join(' ')} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__header">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body
  );
}

/* ── Metrics ──────────────────────────────────────────────────────────── */

export function ProgressBar({
  value,
  tone = 'blue',
  label,
}: {
  value: number;
  tone?: 'blue' | 'green' | 'amber' | 'red';
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="progress" aria-label={label ?? 'Progress'}>
      <div className={`progress__bar progress__bar--${tone}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function ScoreRing({
  score,
  size = 132,
  label,
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const tone = clamped >= 85 ? 'var(--success)' : clamped >= 65 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" role="img" aria-label={`${criteriaLabel(label)} score ${clamped} out of 100`}>
        <circle cx="60" cy="60" r={radius} className="score-ring__track" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          className="score-ring__value"
          stroke={tone}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="score-ring__label">
        <strong>{clamped}</strong>
        <span>{label ?? 'score'}</span>
      </div>
    </div>
  );
}

function criteriaLabel(label: string | undefined): string {
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : 'Health';
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      size="sm"
      variant="ghost"
      icon={copied ? 'check' : 'copy'}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // Clipboard permissions may be denied; the label conveys the state.
        }
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

/* ── Toggle ───────────────────────────────────────────────────────────── */

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="toggle-row">
      <div>
        <label className="toggle-row__label" htmlFor={id}>
          {label}
        </label>
        {description ? <p className="toggle-row__description">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={['toggle', checked ? 'toggle--on' : ''].filter(Boolean).join(' ')}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      >
        <span className="toggle__thumb" />
      </button>
    </div>
  );
}

/* ── Definition list ──────────────────────────────────────────────────── */

export function MetaList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  const filtered = useMemo(() => items.filter((item) => item.value !== undefined && item.value !== null), [items]);
  return (
    <dl className="meta-list">
      {filtered.map((item) => (
        <div key={item.label} className="meta-list__row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
