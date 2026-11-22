import type { CSSProperties } from 'react';

/** The mark: a small sun of warm light. Pure CSS, so it follows the theme and needs no image. */
export function BrandMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  const style: CSSProperties = {
    width: size,
    height: size,
    background: 'radial-gradient(circle at 34% 28%, #fff6dc 0%, #ffcf6e 28%, #ff9a4a 62%, #ff5f7a 100%)',
    boxShadow: '0 0 0 1px rgb(255 255 255 / 0.25) inset, 0 6px 22px -4px color-mix(in oklab, #ff9a4a 70%, transparent)',
  };
  return <span aria-hidden className={`inline-block shrink-0 rounded-[34%] ${className}`} style={style} />;
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <BrandMark />
      {compact ? null : <span className="font-display text-lg font-semibold tracking-tight">Light Manager</span>}
    </span>
  );
}
