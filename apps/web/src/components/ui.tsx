import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { errorMessage, requestIdOf } from '../lib/api';

/* ---------------------------------- Button --------------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-amber-glow text-ink-950 hover:bg-amber-soft font-semibold',
  secondary: 'bg-ink-800 text-ink-100 hover:bg-ink-700 border border-ink-700',
  ghost: 'text-ink-200 hover:bg-ink-800',
  danger: 'bg-bad-wash text-bad border border-bad/40 hover:bg-bad/20',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  busy?: boolean;
  icon?: ReactNode;
  size?: 'sm' | 'md';
}

export function Button({
  variant = 'secondary',
  busy = false,
  icon,
  size = 'md',
  children,
  disabled,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const sizing = size === 'sm' ? 'min-h-9 px-3 text-sm' : 'min-h-11 px-4 text-sm';
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/* ----------------------------------- Card ---------------------------------- */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-ink-700/70 bg-ink-900 ${className}`}>{children}</div>;
}

export function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink-100">{title}</h2>
          {description ? <div className="mt-1 text-sm text-ink-300">{description}</div> : null}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/* ------------------------------- Page heading ------------------------------ */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-100">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-ink-300">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* ---------------------------------- Badges --------------------------------- */

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'amber';

const TONES: Record<Tone, string> = {
  neutral: 'bg-ink-800 text-ink-200 border-ink-700',
  good: 'bg-good-wash text-good border-good/30',
  warn: 'bg-warn-wash text-warn border-warn/30',
  bad: 'bg-bad-wash text-bad border-bad/30',
  info: 'bg-info-wash text-info border-info/30',
  amber: 'bg-amber-wash text-amber-soft border-amber-glow/30',
};

export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

/* --------------------------------- Notices --------------------------------- */

const NOTICE_ICONS = {
  info: Info,
  good: CheckCircle2,
  warn: AlertTriangle,
  bad: XCircle,
} as const;

export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: keyof typeof NOTICE_ICONS;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const Icon = NOTICE_ICONS[tone];
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${TONES[tone]}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorNotice({ error, title, action }: { error: unknown; title?: string; action?: ReactNode }) {
  const reference = requestIdOf(error);
  return (
    <Notice tone="bad" {...(title ? { title } : {})} action={action}>
      {errorMessage(error)}
      {reference ? <span className="mt-1 block text-xs opacity-70">Reference: {reference}</span> : null}
    </Notice>
  );
}

/* --------------------------------- Loading --------------------------------- */

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 p-6 text-sm text-ink-300">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink-700 p-8 text-center">
      {icon ? <div className="text-ink-400">{icon}</div> : null}
      <p className="font-medium text-ink-100">{title}</p>
      {children ? <div className="max-w-md text-sm text-ink-300">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* ---------------------------------- Forms ---------------------------------- */

const INPUT_CLASSES =
  'w-full min-h-11 rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-ink-100 placeholder:text-ink-400 disabled:opacity-50';

export const inputClass = INPUT_CLASSES;

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null | undefined;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-200">
        {label}
      </label>
      {children({
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-ink-400">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1 text-xs text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------- Dialog --------------------------------- */

export function Dialog({
  title,
  open,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // jsdom lacks showModal. Browsers get real modal behaviour and focus handling.
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={`m-auto max-h-[92dvh] w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-0 text-ink-100 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-ink-700 bg-ink-900 px-5 py-3">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose} icon={<X className="size-4" aria-hidden />} />
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}

/* ------------------------------ Definition list ----------------------------- */

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-ink-100">{children}</dd>
    </div>
  );
}
