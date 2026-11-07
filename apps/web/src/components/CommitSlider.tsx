import { useEffect, useId, useRef, useState } from 'react';
import { useSettings } from '../lib/queries';

const COMMIT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * A range input that does not send a request per pixel of movement. By default it
 * sends when released. In "interval" mode it also sends while dragging, at the
 * configured pace. Limits always come from the device's capability.
 */
export function CommitSlider({
  label,
  min,
  max,
  step,
  value,
  unit = '',
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  /** Last known value. Null means unknown, shown as such until the user picks one. */
  value: number | null;
  unit?: string;
  onCommit: (value: number) => void;
}) {
  const id = useId();
  const { data: settings } = useSettings();
  const [draft, setDraft] = useState<number | null>(null);
  const lastSent = useRef<number | null>(null);
  const lastSentAt = useRef(0);
  const trailing = useRef<number | null>(null);
  const latestDraft = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (trailing.current !== null) window.clearTimeout(trailing.current);
    },
    [],
  );

  const shown = draft ?? value ?? min;
  const known = draft !== null || value !== null;

  const send = (next: number) => {
    if (lastSent.current === next) return;
    lastSent.current = next;
    lastSentAt.current = Date.now();
    onCommit(next);
  };

  const commit = () => {
    if (trailing.current !== null) {
      window.clearTimeout(trailing.current);
      trailing.current = null;
    }
    if (draft !== null) send(draft);
  };

  const handleChange = (next: number) => {
    setDraft(next);
    latestDraft.current = next;
    if (settings?.sliderSendMode !== 'interval') return;
    const wait = settings.sliderIntervalMs - (Date.now() - lastSentAt.current);
    if (wait <= 0) {
      send(next);
    } else if (trailing.current === null) {
      trailing.current = window.setTimeout(() => {
        trailing.current = null;
        if (latestDraft.current !== null) send(latestDraft.current);
      }, wait);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-ink-200">
          {label}
        </label>
        <output htmlFor={id} className="text-sm font-semibold text-ink-100 tabular-nums">
          {known ? `${shown}${unit}` : 'Unknown'}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="h-8 w-full"
        min={min}
        max={max}
        step={step}
        value={shown}
        aria-valuetext={known ? `${shown}${unit}` : 'Unknown'}
        onChange={(event) => handleChange(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={(event) => {
          if (COMMIT_KEYS.has(event.key)) commit();
        }}
      />
      <div className="mt-1 flex justify-between text-xs text-ink-400">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </div>
    </div>
  );
}
