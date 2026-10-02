// Follows one pointer for a whole drag at the window level. The Editor redraws its handles on every
// move, which detaches the element that was grabbed; listening on that element (even with pointer
// capture) loses the drag as soon as a fast move leaves the new handle behind.

/** Calls onMove for each move of `pointerId` until it's released or canceled, then onEnd once. */
export function trackPointer(pointerId: number, onMove: (ev: PointerEvent) => void, onEnd: () => void): void {
  const move = (ev: PointerEvent) => {
    if (ev.pointerId === pointerId) onMove(ev);
  };
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    onEnd();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}
