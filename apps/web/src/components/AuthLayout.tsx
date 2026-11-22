import type { ReactNode } from 'react';
import { useDocumentTitle, withAppName } from '../lib/hooks';
import { Ambient } from './Ambient';
import { BrandMark } from './Brand';
import { useInShell } from './shell-context';
import { ThemeCycleButton } from './ThemeToggle';

/**
 * The frame for every page seen before signing in: sign-in, setup, sign-up and the pages that email
 * links open. A warm glow, the mark, and one calm card, so the first screen already feels like the app.
 *
 * Email links also work when someone is already signed in, and then the page is drawn inside the app's
 * shell. The shell has its own page landmark, glow, theme button and tab title, so only the card is drawn.
 */
export function AuthLayout({ children, wide = false, title }: { children: ReactNode; wide?: boolean; title?: string }) {
  const inShell = useInShell();
  useDocumentTitle(!inShell && title ? withAppName(title) : null);

  const card = (
    <div className={`w-full ${inShell ? '' : 'animate-rise'} ${wide ? 'max-w-lg' : 'max-w-md'}`}>
      <div className="mb-7 flex flex-col items-center gap-3 text-center">
        <BrandMark size={64} />
        <p className="font-display text-sm font-semibold tracking-[0.18em] text-fg-3 uppercase">Light Manager</p>
      </div>
      <div className="glass rounded-[2rem] p-7 sm:p-9">{children}</div>
    </div>
  );

  if (inShell) return <div className="flex justify-center py-6">{card}</div>;
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      <Ambient colors={[]} />
      <div className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4">
        <ThemeCycleButton />
      </div>
      {card}
    </main>
  );
}
