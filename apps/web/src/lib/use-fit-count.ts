import { useLayoutEffect, useRef, useState } from 'react';

/** How many items of a given width, with the gaps between them, fit in a row. Never fewer than `min`. */
export function fitCount(width: number, pitch: number, min: number, max: number): number {
  if (!(width > 0) || !(pitch > 0)) return max;
  return Math.min(max, Math.max(min, Math.floor(width / pitch)));
}

/**
 * Counts how many things fit across an element, as it is resized. A string of lights that is drawn
 * with a fixed number of beads would run off the edge of a narrow phone, so it asks how many fit.
 * `pitchRem` is one bead plus its gap. Without ResizeObserver (a test, an old browser) it uses `max`.
 */
export function useFitCount<T extends HTMLElement>(pitchRem: number, min: number, max: number) {
  const ref = useRef<T>(null);
  const [count, setCount] = useState(max);

  // Before paint, so a narrow screen never shows a frame of the full-width row first.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      // rem follows the screen size on big monitors, so measure it rather than assume 16 px.
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setCount(fitCount(element.clientWidth, pitchRem * rem, min, max));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [pitchRem, min, max]);

  return [ref, count] as const;
}
