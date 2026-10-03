// Prints "x,y" (Chrome's window coordinates: top-left of the main screen, y down) of the screen whose
// name is the first argument, or of the first non-main screen if no name matches. macOS only:
//   osascript -l JavaScript scripts/screen-origin.js "AML TV"
ObjC.import("AppKit");

function run(argv) {
  const want = argv[0] || "";
  const screens = ObjC.unwrap($.NSScreen.screens).map((s) => ({
    name: ObjC.unwrap(s.localizedName),
    frame: s.frame,
  }));
  const main = screens[0]; // NSScreen.screens[0] is the main screen (menu bar), whose origin is 0,0
  const pick = screens.find((s) => s.name === want) || screens[1] || main;
  const f = pick.frame;
  // AppKit's y is up from the main screen's bottom; Chrome's is down from its top.
  const y = main.frame.size.height - (f.origin.y + f.size.height);
  return `${Math.round(f.origin.x)},${Math.round(y)}`;
}
