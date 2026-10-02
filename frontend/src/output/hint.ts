type Size = { width: number; height: number };

/** The setup hint must never be projected once the window covers the projector:
 *  it would sit on top of scan patterns. Covers page fullscreen and macOS full screen. */
export function shouldShowHint(s: { pageFullscreen: boolean; window: Size; screen: Size }): boolean {
  if (s.pageFullscreen) return false;
  return s.window.width < s.screen.width || s.window.height < s.screen.height;
}
