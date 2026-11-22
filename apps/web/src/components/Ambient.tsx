import type { CSSProperties } from 'react';
import { useGlowPreference } from '../lib/theme';

/** The glow when nothing is lit, and the first colours any glow falls back on. */
const WARM = ['#ffb547', '#ff7a59', '#8b7bff'] as const;

/**
 * The light behind the app. It takes the colours the lights are showing, so setting the house to
 * red and green makes the screen glow red and green. Three soft pools of colour, no motion beyond
 * a slow fade when the colours change. People can set it to steady warm, or switch it off.
 */
export function Ambient({ colors }: { colors: string[] }) {
  const [preference] = useGlowPreference();
  if (preference === 'off') return null;

  const lit = preference === 'lights' && colors.length > 0;
  const first = lit ? (colors[0] as string) : WARM[0];
  const style = {
    '--glow-1': first,
    '--glow-2': lit ? (colors[1] ?? first) : WARM[1],
    '--glow-3': lit ? (colors[2] ?? WARM[2]) : WARM[2],
  } as CSSProperties;

  return (
    <div aria-hidden className="ambient" style={style}>
      <span />
    </div>
  );
}
