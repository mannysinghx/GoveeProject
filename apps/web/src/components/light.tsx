import type { CSSProperties } from 'react';
import { intToHex, type DeviceDto } from '@glm/shared';
import { useFitCount } from '../lib/use-fit-count';

/*
 * The visual language of the app: what a light is showing, drawn as light.
 * Nothing here is decoration alone. Each piece sits beside the words that say the same thing,
 * and is hidden from screen readers.
 */

const WARM_WHITE = '#ffd9a0';

/** A colour temperature as an approximate screen colour. Good enough to tint a strip. */
export function kelvinToHex(kelvin: number): string {
  const t = Math.min(Math.max(kelvin, 1000), 40000) / 100;
  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const green = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const part = (n: number) => Math.round(Math.min(Math.max(n, 0), 255)).toString(16).padStart(2, '0');
  return `#${part(red)}${part(green)}${part(blue)}`;
}

export interface LightLook {
  /** What it is showing, as a colour. Warm white when it reports no colour. */
  color: string;
  /** 0.3 to 1, from brightness. Dim lights draw dim. */
  lit: number;
  /** Whether it reports being on. Null when it does not say. */
  on: boolean | null;
  /** Online and on, so there is something to animate. */
  live: boolean;
}

/** The newest value Govee reported or accepted, and when, for drawing only. The words beside a picture say which. */
function newestReport(device: DeviceDto, instance: string): { value: unknown; at: string } | null {
  const state = device.states.find((s) => s.instance === instance);
  if (!state) return null;
  const candidates = [state.reported, state.accepted].filter((v): v is NonNullable<typeof v> => Boolean(v));
  return candidates.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}

const positive = (report: { value: unknown } | null): report is { value: number; at: string } =>
  typeof report?.value === 'number' && report.value > 0;

export function lookOfDevice(device: DeviceDto): LightLook {
  // A light Govee no longer lists cannot be said to be on, whatever it last reported.
  const missing = device.discoveryStatus === 'missing';
  const power = newestReport(device, 'powerSwitch')?.value;
  const on = missing ? null : power === 1 ? true : power === 0 ? false : null;
  const brightness = newestReport(device, 'brightness')?.value;

  // A light shows a colour or a colour temperature, and Govee reports 0 for the one it is not using. If both
  // look set, the more recent report is the one in use.
  const rgb = newestReport(device, 'colorRgb');
  const kelvin = newestReport(device, 'colorTemperatureK');
  let color = WARM_WHITE;
  if (positive(rgb) && positive(kelvin)) color = rgb.at >= kelvin.at ? intToHex(rgb.value) : kelvinToHex(kelvin.value);
  else if (positive(rgb)) color = intToHex(rgb.value);
  else if (positive(kelvin)) color = kelvinToHex(kelvin.value);

  const lit = typeof brightness === 'number' ? 0.35 + 0.65 * Math.min(Math.max(brightness, 0), 100) / 100 : 0.85;
  const reachable = device.connectivity !== 'offline' && device.connectivity !== 'checking';
  return { color, lit, on, live: on === true && reachable };
}

/** The colours that tint the glow behind the app: the lights that are on, in the colours they show. */
export function glowColors(devices: DeviceDto[]): string[] {
  const colours = devices
    .filter((d) => d.discoveryStatus === 'present' && !d.isGoveeGroup)
    .map(lookOfDevice)
    .filter((look) => look.on === true && look.live)
    .map((look) => look.color);
  return [...new Set(colours)];
}

type CssVars = CSSProperties & Record<`--${string}`, string | number>;

const DEFAULT_BEAD_REM = 0.6;
/** A bead and the gap after it, in rem, with a little slack so the row can spread evenly. */
const beadPitch = (beadRem: number) => beadRem + 0.35;

/**
 * One string of lights. Dark and hollow when off, breathing softly when live. `count` is the most
 * beads drawn: a narrow screen gets fewer, so the string never runs off the edge.
 */
export function LightStrip({
  color,
  lit = 1,
  on = true,
  live = false,
  count = 24,
  size,
  className = '',
}: {
  color: string;
  lit?: number;
  on?: boolean;
  live?: boolean;
  count?: number;
  size?: string;
  className?: string;
}) {
  const [ref, fit] = useFitCount<HTMLDivElement>(beadPitch(size ? Number.parseFloat(size) : DEFAULT_BEAD_REM), 6, count);
  const style: CssVars = { '--bead': color, '--lit': lit, ...(size ? { '--bead-size': size } : {}) };
  return (
    <div ref={ref} aria-hidden className={`beads flex items-center justify-between gap-1 ${className}`} style={style} {...(live ? { 'data-live': '' } : {})}>
      {Array.from({ length: fit }, (_, index) => (
        <span key={index} className="bead" style={{ '--i': index } as CssVars} {...(on ? {} : { 'data-off': '' })} />
      ))}
    </div>
  );
}

/**
 * Every light at once, as one long string: each light gets its share of the beads, in the colour it is
 * showing. Hollow where a light is off. It is the dashboard's picture of the whole display.
 */
export function HouseStrip({ looks, count = 60, className = '' }: { looks: LightLook[]; count?: number; className?: string }) {
  const [ref, fit] = useFitCount<HTMLDivElement>(beadPitch(DEFAULT_BEAD_REM), 12, count);
  const anyLive = looks.some((look) => look.live);
  return (
    <div ref={ref} aria-hidden className={`beads flex items-center justify-between gap-1 ${className}`} {...(anyLive ? { 'data-live': '' } : {})}>
      {Array.from({ length: fit }, (_, index) => {
        const look = looks.length > 0 ? (looks[Math.floor((index * looks.length) / fit)] as LightLook) : null;
        const style: CssVars = { '--i': index, ...(look ? { '--bead': look.color, '--lit': look.lit } : {}) };
        return <span key={index} className="bead" style={style} {...(look?.on === true ? {} : { 'data-off': '' })} />;
      })}
    </div>
  );
}

/** A row of the colours a look uses, with a soft glow of them underneath. Empty and hollow when it uses none. */
export function Spectrum({ colors, className = '', height = 'h-6' }: { colors: string[]; className?: string; height?: string }) {
  // A look with no colour in it (a preset that only turns lights on, say) is drawn empty, not as an invented colour.
  if (colors.length === 0) {
    return <div aria-hidden className={`rounded-full border border-dashed border-field-line ${height} ${className}`} />;
  }
  const shown = colors;
  const stops = shown.length > 1 ? shown : [shown[0] as string, shown[0] as string];
  const style: CssVars = { '--spectrum': `linear-gradient(90deg in oklab, ${stops.join(', ')})` };
  return (
    <div aria-hidden className={`spectrum flex gap-1 rounded-full ${height} ${className}`} style={style}>
      {shown.map((color, index) => (
        <span key={index} className="min-w-0 flex-1 first:rounded-s-full last:rounded-e-full" style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}

/** The share of lights that are online, as a ring. The numbers and words go beside it. */
export function OnlineRing({ online, total, className = 'size-28' }: { online: number; total: number; className?: string }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const share = total > 0 ? online / total : 0;
  return (
    <div
      role="img"
      aria-label={`${online} of ${total} lights online`}
      className={`relative shrink-0 ${className}`}
    >
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <defs>
          <linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent-hi)" />
            <stop offset="100%" stopColor="#ff7a8a" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--line-strong)" strokeWidth="7" opacity="0.6" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="url(#ring-gradient)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
          style={{ transition: 'stroke-dashoffset 1s var(--ease-out-quint)', filter: 'drop-shadow(0 0 6px color-mix(in oklab, var(--accent) 55%, transparent))' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-xl leading-none font-semibold text-fg tabular-nums sm:text-2xl">
          {online}
          <span className="text-fg-4">/{total}</span>
        </span>
        <span className="mt-1 hidden text-[11px] font-medium tracking-wide text-fg-3 uppercase sm:block">online</span>
      </div>
    </div>
  );
}
