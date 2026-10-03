#!/bin/bash
# Starts auto-mapper for an unattended display: the engine and the web app, then the output window
# fullscreen on the projector. Run at login by the LaunchAgent `make install-autostart` installs.
# Turn on "Start in Play" in the Editor so the engine goes straight to Play with the last show.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

caffeinate -dis &  # keep the Mac and the display awake while this runs
make dev &
until curl -fs http://localhost:5173/api/status >/dev/null 2>&1; do sleep 1; done

# The projector the Editor chose (settings.json), and where macOS put that screen.
projector=$(curl -fs http://localhost:5173/api/status | python3 -c \
  'import json,sys; p=json.load(sys.stdin)["hardware"]["projector"]; print(p["name"] if p else "")')
origin=$(osascript -l JavaScript scripts/screen-origin.js "$projector")

# A separate Chrome profile so these flags apply even when Chrome is already open; sound and
# video start without a click.
open -na "Google Chrome" --args \
  --user-data-dir="$HOME/.auto-mapper/chrome" \
  --app=http://localhost:5173/output.html \
  --window-position="$origin" --start-fullscreen \
  --autoplay-policy=no-user-gesture-required \
  --no-first-run --disable-session-crashed-bubble

wait
