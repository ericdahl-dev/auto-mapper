// The Editor's view of the current show while you edit it: the engine's latest show plus your
// edits that haven't been confirmed yet, gestures (drags) that hold incoming updates back, and
// throttled saving. DOM-free, so it's unit-tested; editor/main.ts only renders and binds events.

import type { ShowMessage, ShowSurface } from "../shared/messages";

type Bezier = NonNullable<ShowSurface["bezier"]>;

/** A change to one surface: its shape (outline, optionally with Bezier curves) and/or settings. */
export interface SurfaceEdit {
  polygon?: number[][];
  bezier?: Bezier;
  params?: Record<string, unknown>;
}

export interface EditSessionOptions {
  /** Saves a change to the engine (PATCH /api/show/surfaces/{id}). */
  patch: (id: number, body: SurfaceEdit) => void;
  /** Runs fn on the next frame; saves are sent at most once per frame. */
  nextFrame?: (fn: () => void) => void;
}

interface Pending {
  shape?: { polygon: number[][]; bezier?: Bezier };
  params?: Record<string, unknown>;
}

export class EditSession {
  private committed: ShowMessage | null = null;
  private held: ShowMessage | null = null; // latest engine show that arrived during a gesture
  private local = new Map<number, Pending>(); // shown on top of committed until confirmed
  private pending = new Map<number, Pending>(); // not sent yet
  private flushQueued = false;
  private gestures = 0;
  private listeners: ((show: ShowMessage) => void)[] = [];
  private readonly sendPatch: EditSessionOptions["patch"];
  private readonly nextFrame: NonNullable<EditSessionOptions["nextFrame"]>;

  constructor(options: EditSessionOptions) {
    this.sendPatch = options.patch;
    this.nextFrame = options.nextFrame ?? ((fn) => void requestAnimationFrame(fn));
  }

  /** Called each time an engine show is applied (once per show, never mid-gesture). */
  subscribe(listener: (show: ShowMessage) => void): void {
    this.listeners.push(listener);
  }

  /** True while a gesture (a drag) is in progress. */
  get busy(): boolean {
    return this.gestures > 0;
  }

  /** An engine show message. Applied now, or after the current gesture ends. */
  receive(msg: ShowMessage): void {
    if (this.busy) {
      this.held = msg; // don't rebuild what's under the pointer; only the latest matters
      return;
    }
    this.commit(msg);
  }

  begin(): void {
    this.gestures++;
  }

  /** Ends a gesture: sends its last edits now and applies any show that arrived meanwhile. */
  end(): void {
    if (!this.busy) return;
    this.gestures--;
    if (this.busy) return;
    this.flush();
    const held = this.held;
    this.held = null;
    if (held) this.commit(held);
  }

  /** Shows a change straight away and saves it: at most one save per frame per surface and kind
   *  of change, so shape edits and settings edits (or two surfaces) never cancel each other. */
  edit(id: number, change: SurfaceEdit): void {
    for (const map of [this.local, this.pending]) {
      const entry = map.get(id) ?? {};
      if (change.polygon) entry.shape = { polygon: change.polygon, ...(change.bezier ? { bezier: change.bezier } : {}) };
      if (change.params) entry.params = { ...entry.params, ...change.params };
      map.set(id, entry);
    }
    if (!this.flushQueued) {
      this.flushQueued = true;
      this.nextFrame(() => this.flush());
    }
  }

  /** The current show as this Editor sees it: the engine's show with unconfirmed edits on top. */
  view(): ShowMessage | null {
    if (!this.committed) return null;
    return { ...this.committed, surfaces: this.committed.surfaces.map((s) => this.withLocal(s)) };
  }

  surface(id: number): ShowSurface | undefined {
    const s = this.committed?.surfaces.find((x) => x.id === id);
    return s && this.withLocal(s);
  }

  private withLocal(s: ShowSurface): ShowSurface {
    const l = this.local.get(s.id);
    if (!l) return s;
    return {
      ...s,
      ...(l.shape ? { polygon: l.shape.polygon, bezier: l.shape.bezier } : {}),
      ...(l.params ? { params: { ...s.params, ...l.params } } : {}),
    };
  }

  private flush(): void {
    this.flushQueued = false;
    for (const [id, p] of this.pending) {
      if (p.shape) this.sendPatch(id, p.shape.bezier ? { polygon: p.shape.polygon, bezier: p.shape.bezier } : { polygon: p.shape.polygon });
      if (p.params) this.sendPatch(id, { params: p.params });
    }
    this.pending.clear();
  }

  private commit(msg: ShowMessage): void {
    this.committed = msg;
    // Sent edits are confirmed by the engine's show; edits still waiting to be sent stay on top.
    for (const id of [...this.local.keys()]) {
      if (!this.pending.has(id)) this.local.delete(id);
    }
    const view = this.view()!;
    this.listeners.forEach((fn) => fn(view));
  }
}
