import { describe, expect, it } from "vitest";
import { hideReplacedNotice, REPLACED_TEXT, showReplacedNotice } from "./replacedNotice";

describe("an output window another one replaced (#159, #169)", () => {
  it("covers its screen once, without telling you to close it (it may be the one on the projector)", () => {
    document.body.innerHTML = "<canvas></canvas>";
    showReplacedNotice(() => {});
    showReplacedNotice(() => {}); // told twice: still one notice
    const notes = document.querySelectorAll("#replaced-notice");
    expect(notes.length).toBe(1);
    expect(notes[0].textContent).toBe(REPLACED_TEXT);
    expect(REPLACED_TEXT.toLowerCase()).not.toContain("close this");
    expect(getComputedStyle(notes[0]).position).toBe("fixed");
  });

  it("takes the projector back when clicked", () => {
    document.body.innerHTML = "<canvas></canvas>";
    let reclaimed = 0;
    showReplacedNotice(() => reclaimed++);
    document.querySelector<HTMLElement>("#replaced-notice")!.click();
    expect(reclaimed).toBe(1);
    expect(document.querySelector("#replaced-notice")).toBeNull();
  });

  it("goes away when the engine hands the projector back", () => {
    document.body.innerHTML = "<canvas></canvas>";
    showReplacedNotice(() => {});
    hideReplacedNotice();
    expect(document.querySelector("#replaced-notice")).toBeNull();
  });
});
