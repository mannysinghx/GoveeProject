import { Lightbulb, Moon, Sparkles } from 'lucide-react';
import { Segmented, SectionCard } from '../../components/ui';
import { ThemeChoice } from '../../components/ThemeToggle';
import { useGlowPreference, type GlowPreference } from '../../lib/theme';

/**
 * How the app looks on this device. Both choices live in this browser only, so a phone and a laptop
 * can differ, and neither is sent anywhere.
 */
export function Appearance() {
  const [glow, setGlow] = useGlowPreference();
  return (
    <SectionCard title="Appearance" description="Kept on this device only. Your phone and your computer can look different.">
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium text-fg-2">Theme</p>
          <ThemeChoice />
          <p className="text-xs text-fg-4">Auto follows your device, so the app turns dark at night if your device does.</p>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-fg-2">Glow behind the app</p>
          <Segmented<GlowPreference>
            label="Glow"
            value={glow}
            onChange={setGlow}
            options={[
              { value: 'lights', label: 'Follow my lights', icon: <Lightbulb className="size-4" aria-hidden /> },
              { value: 'warm', label: 'Steady warm', icon: <Sparkles className="size-4" aria-hidden /> },
              { value: 'off', label: 'Off', icon: <Moon className="size-4" aria-hidden /> },
            ]}
          />
          <p className="text-xs text-fg-4">
            Follow my lights tints the screen with the colour your lights are showing, when Govee has reported one. It never
            changes what is on the screen, only the light around it.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
