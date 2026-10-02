import { describe, expect, it } from "vitest";
import { trackPointer } from "./gesture";

const move = (x: number) => window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, pointerId: 1 }));
const up = () => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));

describe("trackPointer", () => {
  it("keeps following the pointer after the grabbed handle is removed (redrawn) mid-drag", () => {
    const handle = document.createElement("div");
    document.body.append(handle);
    const xs: number[] = [];
    let ended = 0;
    trackPointer(1, (ev) => xs.push(ev.clientX), () => ended++);
    handle.remove(); // what a redraw does to the handle under the pointer
    move(10);
    move(50); // a fast move: far from where the handle was
    up();
    move(90); // after the drag: ignored
    expect(xs).toEqual([10, 50]);
    expect(ended).toBe(1);
  });

  it("ignores other pointers (e.g. a second finger)", () => {
    const xs: number[] = [];
    trackPointer(1, (ev) => xs.push(ev.clientX), () => {});
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 5, pointerId: 2 }));
    move(7);
    up();
    expect(xs).toEqual([7]);
  });

  it("ends on pointercancel too, so a drag can't get stuck", () => {
    let ended = 0;
    trackPointer(1, () => {}, () => ended++);
    window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));
    up();
    expect(ended).toBe(1);
  });
});
