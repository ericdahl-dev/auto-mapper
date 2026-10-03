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
    const key = JSON.stringify(rows.map((r) => [r.id, r.name, r.effect, r.dark])); // not the swatch: color drags
    if (key !== this.shown) {
      this.shown = key;
      // Keep keyboard focus on the same surface; if it was deleted, on the row now in its place.
      const before = [...this.el.querySelectorAll<HTMLElement>("[data-surface]")];
      const at = before.indexOf(document.activeElement as HTMLElement);
      const focusedId = at >= 0 ? before[at].dataset.surface : null;
      this.el.replaceChildren(...rows.map((r) => {
        const li = document.createElement("li");
        const b = Object.assign(document.createElement("button"), { type: "button" });
        b.dataset.surface = String(r.id);
        b.classList.toggle("dark", r.dark);
        b.append(
          Object.assign(document.createElement("span"), { className: "swatch" }),
          Object.assign(document.createElement("span"), { className: "id", textContent: String(r.id) }),
          Object.assign(document.createElement("span"), { className: "name", textContent: r.name }),
          Object.assign(document.createElement("span"), { className: "effect", textContent: r.effect }),
        );
        b.addEventListener("click", (ev) => {
          b.focus(); // Safari doesn't focus a clicked button; the arrow keys need it
          if (ev.shiftKey) this.on.toggle(r.id);
          else this.on.select(r.id);
        });
        li.append(b);
        return li;
      }));
      if (at >= 0) {
        const after = [...this.el.querySelectorAll<HTMLElement>("[data-surface]")];
        (after.find((b) => b.dataset.surface === focusedId) ?? after[Math.min(at, after.length - 1)])?.focus();
      }
    }
    // The selection and colors change often (clicks on the scan, arrow keys, color drags): set in place.
    // One Tab stop, the selected row (else the first); the arrow keys move between rows.
    const buttons = [...this.el.querySelectorAll<HTMLButtonElement>("button[data-surface]")];
    const tabStop = buttons.find((b) => Number(b.dataset.surface) === selected) ?? buttons[0];
    buttons.forEach((b, i) => {
      const id = Number(b.dataset.surface);
      if (id === selected) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
      b.classList.toggle("multi", multi.has(id));
      b.setAttribute("aria-pressed", String(multi.has(id)));
      b.tabIndex = b === tabStop ? 0 : -1;
      b.querySelector<HTMLElement>(".swatch")!.style.background = rows[i]?.swatch ?? "";
    });
  }
}
