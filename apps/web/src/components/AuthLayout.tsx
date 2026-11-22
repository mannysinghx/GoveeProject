import type { ReactNode } from 'react';
import { Ambient } from './Ambient';
import { BrandMark } from './Brand';
import { ThemeCycleButton } from './ThemeToggle';

/**
 * The frame for every page seen before signing in: sign-in, setup, sign-up and the pages that email
 * links open. A warm glow, the mark, and one calm card, so the first screen already feels like the app.
 */
export function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      <Ambient colors={[]} />
      <div className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4">
        <ThemeCycleButton />
      </div>
      <div className={`w-full animate-rise ${wide ? 'max-w-lg' : 'max-w-md'}`}>
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <BrandMark size={64} />
          <p className="font-display text-sm font-semibold tracking-[0.18em] text-fg-3 uppercase">Light Manager</p>
        </div>
        <div className="glass rounded-[2rem] p-7 sm:p-9">{children}</div>
      </div>
    </main>
  );
}
