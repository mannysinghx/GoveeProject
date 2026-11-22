/** Mac, iPhone and iPad: where the shortcut key is Command rather than Control. */
export function isApplePlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
}
