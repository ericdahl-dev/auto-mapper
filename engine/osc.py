"""OSC (UDP) control: a thin adapter that maps addresses onto the engine's own actions (#55).

    /play  /edit                         Play or Edit mode
    /blackout [0|1]                      Blackout on/off; no argument toggles
    /scene/next  /scene/previous         Step through the playlist
    /scene/open <id or name>             Open a scene
    /project/open <name or slug>         Open a saved project (it opens in Play)
    /surface/<id>/effect <effect id>     Change a surface's effect
    /surface/<id>/param/<name> <value>   Set one of its settings, clamped to the effect's range

Unknown addresses and bad values are logged and ignored: a show controller must never stop the show.
"""

import asyncio
import logging
import struct

from engine.effect_settings import BadSetting, checked

log = logging.getLogger(__name__)


def _string(data: bytes, i: int) -> tuple[str, int]:
    end = data.index(b"\0", i)
    return data[i:end].decode(), (end + 4) & ~3


def _message(data: bytes) -> tuple[str, list]:
    address, i = _string(data, 0)
    if i >= len(data):
        return address, []
    tags, i = _string(data, i)
    args: list = []
    for tag in tags[1:]:
        if tag == "i":
            args.append(struct.unpack_from(">i", data, i)[0])
            i += 4
        elif tag == "f":
            args.append(round(struct.unpack_from(">f", data, i)[0], 6))
            i += 4
        elif tag == "s":
            text, i = _string(data, i)
            args.append(text)
        elif tag in "TF":
            args.append(tag == "T")
        else:
            raise ValueError(f"unsupported OSC type {tag}")
    return address, args


def parse_packet(data: bytes) -> list[tuple[str, list]]:
    """The messages in an OSC packet (a message or a bundle of them); [] if it isn't OSC."""
    try:
        if data.startswith(b"#bundle\0"):
            out, i = [], 16
            while i < len(data):
                size = struct.unpack_from(">i", data, i)[0]
                out += parse_packet(data[i + 4:i + 4 + size])
                i += 4 + size
            return out
        if not data.startswith(b"/"):
            return []
        return [_message(data)]
    except (ValueError, struct.error, UnicodeDecodeError, IndexError):
        return []


class OscControl:
    def __init__(self, show, projects):
        self.show, self.projects = show, projects

    def handle(self, address: str, args: list) -> None:
        show = self.show
        parts = address.strip("/").split("/")
        try:
            if address == "/play":
                show.present(mode="play")
            elif address == "/edit":
                show.present(mode="edit")
            elif address == "/blackout":
                show.present(blackout=bool(args[0]) if args else not show.presentation["blackout"])
            elif show.data is None:
                raise LookupError("no show yet")
            elif address == "/scene/next":
                show.step_scene(1)
            elif address == "/scene/previous":
                show.step_scene(-1)
            elif address == "/scene/open":
                want = args[0]
                scene = next(sc for sc in show.data["scenes"] if sc["id"] == want or sc["name"] == want)
                show.open_scene(scene["id"])
            elif address == "/project/open":
                want = str(args[0])
                project = next(p for p in self.projects.list() if want in (p["slug"], p["name"]))
                self.projects.open(project["slug"])
            elif len(parts) == 3 and parts[0] == "surface" and parts[2] == "effect":
                show.update(int(parts[1]), effect=str(args[0]))
            elif len(parts) == 4 and parts[0] == "surface" and parts[2] == "param":
                sid, name = int(parts[1]), parts[3]
                effect = next(s["effect"] for s in show.data["surfaces"] if s["id"] == sid)
                show.update(sid, params={name: checked(effect, name, args[0])})
            else:
                log.info("OSC: unknown address %s", address)
        except (BadSetting, LookupError, StopIteration, IndexError, ValueError) as e:
            log.info("OSC: ignored %s %s: %s", address, args, e)


class _Protocol(asyncio.DatagramProtocol):
    def __init__(self, control: OscControl):
        self.control = control

    def datagram_received(self, data: bytes, addr) -> None:
        for address, args in parse_packet(data):
            self.control.handle(address, args)


class OscServer:
    """Listens on a UDP port while OSC is on."""

    def __init__(self, control: OscControl):
        self.control = control
        self._transport: asyncio.DatagramTransport | None = None

    @property
    def port(self) -> int | None:
        return self._transport.get_extra_info("sockname")[1] if self._transport else None

    async def start(self, port: int) -> None:
        self.stop()
        loop = asyncio.get_running_loop()
        self._transport, _ = await loop.create_datagram_endpoint(
            lambda: _Protocol(self.control), local_addr=("0.0.0.0", port))

    def stop(self) -> None:
        if self._transport:
            self._transport.close()
            self._transport = None
