import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { errorMessage, requestIdOf } from '../lib/api';

/* ---------------------------------- Button --------------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'btn-primary font-semibold',
  secondary: 'border border-line-strong bg-raised/70 text-fg hover:bg-raised hover:border-fg-4/50',
  ghost: 'text-fg-2 hover:bg-raised/80 hover:text-fg',
  danger: 'border border-bad/40 bg-bad-wash text-bad hover:border-bad/70',
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
  const sizing = size === 'sm' ? 'min-h-9 px-3.5 text-sm' : 'min-h-11 px-5 text-sm';
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[transform,background-color,border-color,filter,opacity] duration-200 ease-out select-none active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${sizing} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/** A choice of one among a few, shown as a row of pills. Each option is a real button. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`inline-flex rounded-full border border-line bg-inset p-1 ${className}`}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors duration-200 ${
              active ? 'bg-accent-wash text-accent-text shadow-sm ring-1 ring-accent-ui/40' : 'text-fg-3 hover:text-fg'
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------- Card ---------------------------------- */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card rounded-3xl ${className}`}>{children}</div>;
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
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight text-fg">{title}</h2>
          {description ? <div className="mt-1 text-sm text-fg-3">{description}</div> : null}
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
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-accent-text uppercase">{eyebrow}</p> : null}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-3 sm:text-base">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* ---------------------------------- Badges --------------------------------- */

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'amber';

const TONES: Record<Tone, string> = {
  neutral: 'bg-raised/70 text-fg-2 border-line-strong/70',
  good: 'bg-good-wash text-good border-good/30',
  warn: 'bg-warn-wash text-warn border-warn/30',
  bad: 'bg-bad-wash text-bad border-bad/30',
  info: 'bg-info-wash text-info border-info/30',
  amber: 'bg-accent-wash text-accent-text border-accent-ui/30',
};

export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}
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

const NOTICE_BAR: Record<keyof typeof NOTICE_ICONS, string> = {
  info: 'before:bg-info',
  good: 'before:bg-good',
  warn: 'before:bg-warn',
  bad: 'before:bg-bad',
};

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
      className={`relative flex items-start gap-3 overflow-hidden rounded-2xl border py-3.5 pr-4 pl-5 text-sm before:absolute before:inset-y-0 before:left-0 before:w-1.5 ${NOTICE_BAR[tone]} ${TONES[tone]}`}
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

/** A calm pulse in place of a spinner. The words are there for screen readers. */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="space-y-3 p-2">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="space-y-3">
        <div className="h-5 w-2/5 animate-shimmer rounded-full bg-raised" />
        <div className="h-24 animate-shimmer rounded-3xl bg-raised/70" />
        <div className="h-5 w-3/5 animate-shimmer rounded-full bg-raised/70" />
      </div>
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
    <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-line-strong p-8 text-center sm:p-10">
      {icon ? (
        <div className="mb-1 flex size-16 items-center justify-center rounded-full bg-accent-wash text-accent-text ring-1 ring-accent-ui/25">
          {icon}
        </div>
      ) : null}
      <p className="font-display text-lg font-semibold text-fg">{title}</p>
      {children ? <div className="max-w-md text-sm text-fg-3">{children}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/* ---------------------------------- Forms ---------------------------------- */

const INPUT_CLASSES =
  'w-full min-h-11 rounded-2xl border border-line-strong bg-inset px-4 text-sm text-fg placeholder:text-fg-4 transition-[border-color,box-shadow] duration-200 hover:border-fg-4/60 focus:border-accent-ui focus:outline-none focus:ring-4 focus:ring-accent-ui/20 disabled:opacity-50 aria-[invalid=true]:border-bad';

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
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg-2">
        {label}
      </label>
      {children({
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-fg-4">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------- Dialog --------------------------------- */

/** Opens and closes a native dialog as `open` changes. Browsers give real modal behaviour. */
export function useNativeDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // jsdom lacks showModal, so it gets a plain open dialog.
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);
  return ref;
}

/**
 * Closes a dialog when the dim area around it is clicked. It has to start there too: selecting text
 * inside the dialog and letting go outside it must not close it.
 */
export function useBackdropClose(ref: RefObject<HTMLDialogElement | null>, onClose: () => void) {
  const startedOnBackdrop = useRef(false);
  return {
    onPointerDown: (event: ReactPointerEvent) => {
      startedOnBackdrop.current = event.target === ref.current;
    },
    onClick: (event: ReactMouseEvent) => {
      if (startedOnBackdrop.current && event.target === ref.current) onClose();
      startedOnBackdrop.current = false;
    },
  };
}

/**
 * A native dialog, so focus is trapped and Escape works without extra code. On a phone it rises
 * from the bottom as a sheet, which is where a thumb is. From tablet up it sits in the middle.
 */
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
  const ref = useNativeDialog(open);
  const backdrop = useBackdropClose(ref, onClose);
  const titleId = useId();

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      {...backdrop}
      className={`glass fixed inset-x-0 top-auto bottom-0 m-0 mx-auto max-h-[92dvh] w-full max-w-none animate-sheet overflow-y-auto overscroll-contain rounded-t-[2rem] rounded-b-none p-0 text-fg sm:inset-0 sm:m-auto sm:h-fit sm:w-[calc(100vw-3rem)] sm:animate-pop sm:rounded-[2rem] ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
    >
      <div className="sticky top-0 z-10 border-b border-line bg-surface/85 px-6 pt-2 pb-3 backdrop-blur-xl sm:pt-4">
        <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="font-display text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose} icon={<X className="size-4" aria-hidden />} />
        </div>
      </div>
      <div className="p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>
    </dialog>
  );
}

/* ------------------------------ Definition list ----------------------------- */

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-fg-4">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-fg">{children}</dd>
    </div>
  );
}
