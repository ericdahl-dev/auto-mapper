import { describe, expect, it } from "vitest";
import { foldOpen, problemFolds } from "./folds";

describe("which sidebar sections are open", () => {
  it("everyday sections start open; set-up-once ones start folded", () => {
    expect(foldOpen("project", {}, new Set())).toBe(true);
    expect(foldOpen("scenes", {}, new Set())).toBe(true);
    expect(foldOpen("sound", {}, new Set())).toBe(true);
    for (const name of ["schedule", "midi", "hardware", "camera", "test-frame"]) expect(foldOpen(name, {}, new Set())).toBe(false);
  });

  it("remembers what you opened or folded", () => {
    expect(foldOpen("midi", { midi: true }, new Set())).toBe(true);
    expect(foldOpen("project", { project: false }, new Set())).toBe(false);
  });

  it("opens a section with a problem, whatever you chose, so collapsing never hides one", () => {
    expect(foldOpen("hardware", { hardware: false }, new Set(["hardware"]))).toBe(true);
  });
});

describe("sections with a problem", () => {
  const ok = { hardware: { issues: [], projector_missing: null }, output_sound: null, output_sound_output_error: null, output_video_sound_blocked: false };

  it("Hardware when the projector or camera is missing", () => {
    expect(problemFolds({ ...ok, hardware: { issues: ["no_projector"], projector_missing: null } })).toEqual(new Set(["hardware"]));
    expect(problemFolds({ ...ok, hardware: { issues: [], projector_missing: "P24q-10" } })).toEqual(new Set(["hardware"]));
  });

  it("Sound when sound can't play or listen", () => {
    expect(problemFolds({ ...ok, output_video_sound_blocked: true })).toEqual(new Set(["sound"]));
    expect(problemFolds({ ...ok, output_sound_output_error: "not available" })).toEqual(new Set(["sound"]));
    expect(problemFolds({ ...ok, output_sound: { level: 0, error: "Microphone blocked" } })).toEqual(new Set(["sound"]));
  });

  it("none when all is well", () => {
    expect(problemFolds(ok)).toEqual(new Set());
    expect(problemFolds(null)).toEqual(new Set());
  });
});
