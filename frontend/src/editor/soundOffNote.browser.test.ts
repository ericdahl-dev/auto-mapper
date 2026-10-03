import { describe, expect, it } from "vitest";
import { soundOffNote } from "./soundOffNote";

describe("the (sound is off) note by a sound-reactive setting", () => {
  it("opens the Sound section and puts you on its on/off switch", () => {
    document.body.innerHTML = `
      <label class="control"><span>React to sound</span><input id="react" type="range" /></label>
      <details class="fold" data-fold="sound"><summary>Sound</summary><button id="sound-toggle">React to sound: off</button></details>`;
    const note = soundOffNote();
    const row = document.querySelector("label")!;
    row.append(note);
    expect(row.control?.id).toBe("react"); // the label still names the slider
    expect(note.textContent).toBe("(sound is off)");
    note.click();
    expect(document.querySelector<HTMLDetailsElement>("details[data-fold=sound]")!.open).toBe(true);
    expect(document.activeElement?.id).toBe("sound-toggle");
  });
});
