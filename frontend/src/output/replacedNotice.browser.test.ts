import { describe, expect, it } from "vitest";
import { REPLACED_TEXT, showReplacedNotice } from "./replacedNotice";

describe("an output window another one replaced (#159)", () => {
  it("covers its screen with a notice saying to close it, once", () => {
    document.body.innerHTML = "<canvas></canvas>";
    showReplacedNotice();
    showReplacedNotice(); // told twice: still one notice
    const notes = document.querySelectorAll("#replaced-notice");
    expect(notes.length).toBe(1);
    expect(notes[0].textContent).toBe(REPLACED_TEXT);
    expect(getComputedStyle(notes[0]).position).toBe("fixed");
  });
});
