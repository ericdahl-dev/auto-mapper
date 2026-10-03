import { beforeEach, describe, expect, it } from "vitest";
import { SurfaceList, type SurfaceRow } from "./surfaceList";

const ROWS: SurfaceRow[] = [
  { id: 1, name: "Left door", effect: "Fill", dark: false, swatch: "rgba(0, 0, 255, 0.35)" },
  { id: 2, name: "Right door", effect: "None (dark)", dark: true, swatch: null },
  { id: 5, name: "Lamp", effect: "Noise flow", dark: false, swatch: "rgba(0, 0, 255, 0.35)" },
];

let el: HTMLElement;
let calls: string[];
let list: SurfaceList;
const row = (id: number) => el.querySelector<HTMLButtonElement>(`[data-surface="${id}"]`)!;

beforeEach(() => {
  document.body.innerHTML = "";
  el = document.createElement("ul");
  document.body.append(el);
  calls = [];
  list = new SurfaceList(el, { select: (id) => calls.push(`select ${id}`), toggle: (id) => calls.push(`toggle ${id}`) });
});

describe("the Surfaces list", () => {
  it("shows id, name and effect, and a click selects that surface", () => {
    list.render(ROWS, null, new Set());
    expect(row(2).textContent).toContain("2");
    expect(row(2).textContent).toContain("Right door");
    expect(row(2).textContent).toContain("None (dark)");
    row(5).click();
    expect(calls).toEqual(["select 5"]);
  });

  it("adds to the selection on Shift-click, like Shift-click on the scan", () => {
    list.render(ROWS, 1, new Set());
    row(5).dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    expect(calls).toEqual(["toggle 5"]);
  });

  it("follows the selection (from the scan too) without rebuilding the rows under the pointer", () => {
    list.render(ROWS, 1, new Set());
    const before = row(2);
    expect(row(1).getAttribute("aria-current")).toBe("true");
    list.render(ROWS, 2, new Set([2, 5]));
    expect(row(2)).toBe(before);
    expect(row(1).hasAttribute("aria-current")).toBe(false);
    expect(row(2).getAttribute("aria-current")).toBe("true");
    expect(row(5).classList.contains("multi")).toBe(true);
    expect(row(1).classList.contains("multi")).toBe(false);
  });

  it("rebuilds when a name or effect changes", () => {
    list.render(ROWS, null, new Set());
    list.render([{ ...ROWS[0], effect: "Text" }, ROWS[1], ROWS[2]], null, new Set());
    expect(row(1).textContent).toContain("Text");
  });

  it("moves the selection with the arrow keys, focus following, without the page's own keys firing", () => {
    const reachedWindow: string[] = [];
    const spy = (ev: KeyboardEvent) => reachedWindow.push(ev.key);
    window.addEventListener("keydown", spy);
    const press = (key: string) => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    list.render(ROWS, 1, new Set());
    row(1).focus();
    press("ArrowDown");
    expect(calls).toEqual(["select 2"]);
    expect(document.activeElement).toBe(row(2));
    press("End");
    press("ArrowDown"); // already last: stays
    press("Home");
    press("ArrowUp"); // already first: stays
    expect(calls).toEqual(["select 2", "select 5", "select 1"]);
    expect(document.activeElement).toBe(row(1));
    expect(reachedWindow).toEqual([]);
    window.removeEventListener("keydown", spy);
  });

  it("keeps keyboard focus on the same surface when the rows are rebuilt", () => {
    list.render(ROWS, 2, new Set());
    row(2).focus();
    list.render([ROWS[0], { ...ROWS[1], name: "Renamed" }, ROWS[2]], 2, new Set());
    expect(document.activeElement).toBe(row(2));
  });
});
