// Applies only the newest of several values arriving within one frame (#161): a surface drag sends
// the whole show on every step, faster than the output window needs to take them.

export interface LatestPerFrame<T> {
  push(value: T): void; // apply on the next frame, unless a newer value replaces it first
  cancel(): void; // drop the pending value (something else took over the screen)
}

export function latestPerFrame<T>(
  apply: (value: T) => void,
  nextFrame: (fn: () => void) => void = (fn) => void requestAnimationFrame(fn),
): LatestPerFrame<T> {
  let pending: { value: T } | null = null;
  let scheduled = false;
  return {
    push(value) {
      pending = { value };
      if (scheduled) return;
      scheduled = true;
      nextFrame(() => {
        scheduled = false;
        const p = pending;
        pending = null;
        if (p) apply(p.value);
      });
    },
    cancel() {
      pending = null;
    },
  };
}
