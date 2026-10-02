import { type ClientHello, type ClientMessage, type ServerMessage, parseServerMessage } from "./messages";

export interface Connection {
  send(msg: ClientMessage): void;
}

/** Connects to the engine WebSocket, sends hello on every (re)connect, and retries forever. */
export function connect(opts: {
  hello: () => ClientHello;
  onMessage: (msg: ServerMessage) => void;
  onOpenChange?: (open: boolean) => void;
}): Connection {
  let ws: WebSocket | null = null;
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

  const open = () => {
    ws = new WebSocket(url);
    ws.onopen = () => {
      ws?.send(JSON.stringify(opts.hello()));
      opts.onOpenChange?.(true);
    };
    ws.onmessage = (ev) => {
      const msg = parseServerMessage(String(ev.data));
      if (msg) opts.onMessage(msg);
    };
    ws.onclose = () => {
      opts.onOpenChange?.(false);
      setTimeout(open, 1000);
    };
  };
  open();

  return {
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  };
}
