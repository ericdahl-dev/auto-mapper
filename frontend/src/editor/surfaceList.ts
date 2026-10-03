// The Surfaces list above the surface panel (#121): pick surfaces by name, from the mouse or the
// keyboard, and see which effect each has. Small or packed surfaces are hard to click on the scan.
import { effectById } from "../effects/index";
import { surfaceFill } from "./surfaceFill";

export interface SurfaceRow {
  id: number;
  name: string;
  effect: string;
  dark: boolean; // None (dark): stands out in the list
  swatch: string | null; // its tint on the scan (surfaceFill.ts); null for None, shown hatched
}

/** One row per surface, in the show's order. */
export function surfaceRows(surfaces: { id: number; name?: string | null; effect: string; params: Record<string, unknown> }[]): SurfaceRow[] {
  return surfaces.map((s) => {
    const effect = effectById(s.effect);
    const dark = effect.fragment === null;
    return { id: s.id, name: s.name || `Surface ${s.id}`, effect: effect.name, dark, swatch: dark ? null : surfaceFill(effect, s.params) };
  });
}

/** The list itself: rows are buttons; it's rebuilt only when a row's text changes (see render). */
export class SurfaceList {
  private shown = ""; // the rows last built

  constructor(private el: HTMLElement, private on: { select(id: number): void; toggle(id: number): void }) {
    // Up and Down (Home, End) move the selection from the focused row; focus goes with it. Kept from
    // the page's own keys, so they don't also do something else.
    el.addEventListener("keydown", (ev) => {
      const step: Record<string, (i: number, n: number) => number> = {
        ArrowDown: (i, n) => Math.min(n - 1, i + 1), ArrowUp: (i) => Math.max(0, i - 1), Home: () => 0, End: (_i, n) => n - 1,
      };
      const move = step[ev.key];
      if (!move || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
      ev.preventDefault(); // no page scroll
      ev.stopPropagation();
      const rows = [...el.querySelectorAll<HTMLButtonElement>("button[data-surface]")];
      if (!rows.length) return;
      const at = rows.indexOf(document.activeElement as HTMLButtonElement);
      const current = at >= 0 ? at : rows.findIndex((b) => b.hasAttribute("aria-current"));
      const next = rows[current < 0 ? 0 : move(current, rows.length)];
      if (next === rows[current]) return;
      next.focus();
      next.scrollIntoView({ block: "nearest" });
      this.on.select(Number(next.dataset.surface));
    });
  }

  render(rows: SurfaceRow[], selected: number | null, multi: Set<number>): void {
    const key = JSON.stringify(rows);
    if (key !== this.shown) {
      this.shown = key;
      const focused = (document.activeElement as HTMLElement | null)?.closest?.("[data-surface]");
      const refocus = focused && this.el.contains(focused) ? (focused as HTMLElement).dataset.surface : null;
      this.el.replaceChildren(...rows.map((r) => {
        const li = document.createElement("li");
        const b = Object.assign(document.createElement("button"), { type: "button" });
        b.dataset.surface = String(r.id);
        b.classList.toggle("dark", r.dark);
        const swatch = Object.assign(document.createElement("span"), { className: "swatch" });
        if (r.swatch) swatch.style.background = r.swatch;
        b.append(
          swatch,
          Object.assign(document.createElement("span"), { className: "id", textContent: String(r.id) }),
          Object.assign(document.createElement("span"), { className: "name", textContent: r.name }),
          Object.assign(document.createElement("span"), { className: "effect", textContent: r.effect }),
        );
        b.addEventListener("click", (ev) => (ev.shiftKey ? this.on.toggle(r.id) : this.on.select(r.id)));
        li.append(b);
        return li;
      }));
      if (refocus) this.el.querySelector<HTMLElement>(`[data-surface="${refocus}"]`)?.focus();
    }
    // The selection changes often (clicks on the scan, arrow keys): marked in place.
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("button[data-surface]")) {
      const id = Number(b.dataset.surface);
      if (id === selected) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
      b.classList.toggle("multi", multi.has(id));
    }
  }
}
