import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "./toast";

afterEach(() => vi.useRealTimers());

describe("toasts", () => {
  it("hides a success after 6 s but keeps a failure until it's closed (#171)", () => {
    vi.useFakeTimers();
    const box = document.createElement("div");
    toast(box, "Saved.");
    toast(box, "Scan failed: the camera didn't answer within 10 s", true);
    vi.advanceTimersByTime(60_000);
    expect(box.children).toHaveLength(1);
    expect(box.textContent).toContain("Scan failed: the camera didn't answer within 10 s");
    box.querySelector<HTMLButtonElement>("button[aria-label=Dismiss]")!.click();
    expect(box.children).toHaveLength(0);
  });

  it("shows a repeated message once, but different messages each (#171)", () => {
    const box = document.createElement("div");
    toast(box, "Cannot scan: no camera", true);
    toast(box, "Cannot scan: no camera", true);
    expect(box.children).toHaveLength(1);
    toast(box, "Scan failed: the camera sent no photo", true);
    expect(box.children).toHaveLength(2);
  });
});
