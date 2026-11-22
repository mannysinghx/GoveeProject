import { Moon, Sun, SunMoon } from 'lucide-react';
import { Segmented } from './ui';
import { useTheme, type ThemePreference } from '../lib/theme';

const ORDER: ThemePreference[] = ['auto', 'light', 'dark'];
const NAME: Record<ThemePreference, string> = { auto: 'Match this device', light: 'Day', dark: 'Night' };

/** One tap to the next theme, for the top bar. The full choice is in Settings and the More sheet. */
export function ThemeCycleButton() {
  const { preference, setPreference } = useTheme();
  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length] as ThemePreference;
  const Icon = preference === 'light' ? Sun : preference === 'dark' ? Moon : SunMoon;
  return (
    <button
      type="button"
      aria-label={`Theme: ${NAME[preference]}. Switch to ${NAME[next]}.`}
      title={`Theme: ${NAME[preference]}`}
      onClick={() => setPreference(next)}
      className="flex size-11 items-center justify-center rounded-full border border-line bg-surface/70 text-fg-2 backdrop-blur-md transition-colors hover:text-fg"
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}

/** The full choice: follow the device, always Day, or always Night. */
export function ThemeChoice() {
  const { preference, setPreference } = useTheme();
  return (
    <Segmented<ThemePreference>
      label="Theme"
      value={preference}
      onChange={setPreference}
      options={[
        { value: 'auto', label: 'Auto', icon: <SunMoon className="size-4" aria-hidden /> },
        { value: 'light', label: 'Day', icon: <Sun className="size-4" aria-hidden /> },
        { value: 'dark', label: 'Night', icon: <Moon className="size-4" aria-hidden /> },
      ]}
    />
  );
}
