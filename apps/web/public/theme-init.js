/* global window, document */
/*
 * Sets the theme before the first paint, so a light device does not flash dark and a dark one
 * does not flash light. It has to be a file of its own: the server's content security policy
 * allows scripts from this site only, not inline ones. Keep it in step with src/lib/theme.ts.
 */
(function () {
  var preference = 'auto';
  try {
    var stored = window.localStorage.getItem('glm.theme');
    if (stored === 'light' || stored === 'dark' || stored === 'auto') preference = stored;
  } catch {
    // Storage can be blocked. The device's own setting is used.
  }
  var prefersLight = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;
  var theme = preference === 'auto' ? (prefersLight ? 'light' : 'dark') : preference;
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f5f2ec' : '#0a0a14');
})();
