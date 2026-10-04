"""make scan-check (#15): run a real scan on the running engine and print what it found.

Needs `make dev` running with the rig ready (output window fullscreen on the projector, camera
selected). Listens as an editor for the scan's result, so it waits as long as the scan takes.
"""

import asyncio
import json
import sys
import urllib.error
import urllib.request

import websockets

ENGINE = "127.0.0.1:8765"


def post(path: str) -> tuple[int, dict]:
    req = urllib.request.Request(f"http://{ENGINE}{path}", method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")
    except urllib.error.URLError as e:
        sys.exit(f"The engine isn't running ({e.reason}): start it with make dev")


async def main() -> int:
    async with websockets.connect(f"ws://{ENGINE}/ws", max_size=None) as ws:
        await ws.send(json.dumps({"type": "hello", "role": "editor"}))
        status, body = post("/api/scan")
        if status != 202:
            print(f"Can't scan: {body.get('detail', status)}")
            return 1
        print("Scanning...", flush=True)
        while True:
            msg = json.loads(await ws.recv())
            if msg["type"] == "scan_progress":
                print(f"\r  pattern {msg['done']}/{msg['total']}", end="", flush=True)
            elif msg["type"] == "scan_failed":
                print(f"\nScan failed: {msg['error']}")
                return 1
            elif msg["type"] == "scan_canceled":
                print("\nScan canceled")
                return 1
            elif msg["type"] == "scan_result":
                print(f"\nCoverage {msg['coverage']:.1%}, {len(msg['surfaces'])} surfaces, {msg['seconds']} s, "
                      f"{msg['width']}x{msg['height']}")
                for w in msg.get("warnings", []):
                    print(f"  warning: {w}")
                return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
