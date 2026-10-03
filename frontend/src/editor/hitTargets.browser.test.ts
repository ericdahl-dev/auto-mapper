import { describe, expect, it } from "vitest";
import html from "../../index.html?raw";

// Interactive targets are at least 24 px (#124), with the Editor's own CSS.
const style = html.match(/<style>([\s\S]*?)<\/style>/)![1];

function page(body: string) {
  document.head.innerHTML = `<style>${style}</style>`;
  document.body.innerHTML = body;
}

describe("hit targets", () => {
  it("lets you grab an outline handle 12 px from its center, though it looks smaller", () => {
    page(`<svg id="surfaces" width="400" height="200" viewBox="0 0 400 200" style="position: absolute; left: 0; top: 0">
      <circle class="handle" cx="100" cy="100" r="7" />
      <rect class="handle anchor" x="193" y="93" width="14" height="14" />
    </svg>`);
    const [circle, square] = [...document.querySelectorAll(".handle")];
    expect(document.elementFromPoint(111, 100)).toBe(circle);
    expect(document.elementFromPoint(100, 89)).toBe(circle);
    expect(document.elementFromPoint(211, 100)).toBe(square);
  });

  it("makes fold headings and scene row buttons at least 24 px tall", () => {
    page(`<aside><details class="fold"><summary><h2>Scenes</h2></summary>
      <ol id="scene-list"><li><input type="text" /><button>↑</button></li></ol></details></aside>`);
    document.querySelector("details")!.open = true;
    expect(document.querySelector("summary")!.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    const button = document.querySelector("#scene-list button")!.getBoundingClientRect();
    expect(Math.min(button.width, button.height)).toBeGreaterThanOrEqual(24);
  });
});
