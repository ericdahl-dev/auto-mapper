import { describe, expect, it } from "vitest";
import { nextChangeText } from "./scheduleView";

describe("the schedule's next change, in words", () => {
  const now = new Date("2026-10-05T12:00:00"); // a Monday

  it("says when the display next turns on or off", () => {
    expect(nextChangeText({ at: "2026-10-05T17:30:00", on: true }, now)).toBe("Turns on today at 17:30");
    expect(nextChangeText({ at: "2026-10-06T02:00:00", on: false }, now)).toBe("Turns off tomorrow at 02:00");
    expect(nextChangeText({ at: "2026-10-08T17:30:00", on: true }, now)).toBe("Turns on Thursday at 17:30");
  });

  it("says when the schedule is off", () => {
    expect(nextChangeText(null, now)).toBe("Schedule off");
  });
});
