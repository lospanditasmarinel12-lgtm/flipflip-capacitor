/**
 * Tracks the visible viewport height (Android WebView resizes when the soft
 * keyboard appears even with windowSoftInputMode=adjustResize, but `100vh`
 * does not follow). We set `--app-height` from the actual visible height so
 * root/fixed containers (`height: var(--app-height, 100vh)`) shrink when the
 * keyboard opens on Android — while iOS falls back to `100vh` unchanged.
 */
export function initViewportHeight(): void {
  const apply = () => {
    try {
      // Prefer the layout-viewport height (the ICB): it is the canonical value
      // for `100vh`-equivalent sizing and shrinks correctly with the soft
      // keyboard under interactive-widget=resizes-content. Fall back to the
      // visual viewport when innerHeight is unavailable, and never let a stale
      // (larger) visualViewport override a smaller window.innerHeight.
      const inner = window.innerHeight;
      const vv = (window as any).visualViewport as VisualViewport | undefined;
      let height = inner;
      if (vv && vv.height && (inner == null || inner === 0 || vv.height < inner)) {
        height = vv.height;
      }
      document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
    } catch (e) {
      document.documentElement.style.setProperty('--app-height', `${Math.round(window.innerHeight)}px`);
    }
  };

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  const vv = (window as any).visualViewport as VisualViewport | undefined;
  if (vv) {
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
  }
}
