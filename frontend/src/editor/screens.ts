// Puts the output window on the projector's screen, using Chrome's Window Management API
// (getScreenDetails). Other browsers don't have it; there the user drags the window.

export interface ScreenInfo {
  label: string;
  left: number;
  top: number;
  width: number; // CSS pixels
  height: number;
  devicePixelRatio: number;
}

/** The browser screen that is the engine's projector: by name, else by unique device-pixel size. */
export function matchScreen<S extends ScreenInfo>(
  screens: S[],
  projector: { name: string; width: number; height: number },
): S | null {
  const byName = screens.find((s) => s.label === projector.name);
  if (byName) return byName;
  const bySize = screens.filter(
    (s) => Math.round(s.width * s.devicePixelRatio) === projector.width && Math.round(s.height * s.devicePixelRatio) === projector.height,
  );
  return bySize.length === 1 ? bySize[0] : null;
}

const OUTPUT_NAME = "auto-mapper-output";

/** Opens the output window, or moves the open one, onto the projector's screen. Must run in a click
 *  or change handler: the first call asks for the "window management" permission. Returns a note
 *  for the user when it can't place the window itself. */
export async function placeOutput(projector: { name: string; width: number; height: number } | null): Promise<string | null> {
  // An empty URL returns the already-open output window without reloading it.
  const existing = window.open("", OUTPUT_NAME, "popup");
  const isOpen = existing !== null && existing.location.href !== "about:blank";
  const win = isOpen ? existing : window.open("/output.html", OUTPUT_NAME, "popup,width=960,height=540");
  if (!win || !projector) return null;
  if (!("getScreenDetails" in window)) return "Drag the output window onto the projector, then click it to go fullscreen.";
  let screen: ScreenInfo | null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const details = await (window as any).getScreenDetails();
    screen = matchScreen(details.screens as ScreenInfo[], projector);
  } catch {
    return "Allow window management for this page to move the output automatically, or drag it onto the projector.";
  }
  if (!screen) return `Couldn't find ${projector.name} among the browser's screens. Drag the output window onto it.`;
  win.moveTo(screen.left, screen.top);
  win.resizeTo(screen.width, screen.height);
  return "Output moved to the projector. Click it once to go fullscreen.";
}
