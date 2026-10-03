// The engine clamps settings it receives from outside the Editor (OSC, MIDI) to each effect's ranges,
// which are defined here in TypeScript. This test records them to engine/effect_settings.json and fails
// when that file is out of date. To accept a change: UPDATE_EFFECT_SETTINGS=1 npx vitest run.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EFFECTS } from "./index";
import { settingsRecord } from "./settingsRecord";

const FILE = fileURLToPath(new URL("../../../engine/effect_settings.json", import.meta.url));

describe("effect settings recorded for the engine", () => {
  it("records each setting's type, range, options and default", () => {
    const fill = settingsRecord(EFFECTS).fill;
    expect(fill.colorA).toMatchObject({ type: "color" });
    const media = settingsRecord(EFFECTS).media;
    expect(media.zoom).toMatchObject({ type: "number", min: expect.any(Number), max: expect.any(Number) });
    expect(media.fit).toMatchObject({ type: "choice", options: expect.arrayContaining(["cover"]) });
  });

  it("engine/effect_settings.json is up to date", () => {
    const current = JSON.stringify(settingsRecord(EFFECTS), null, 2) + "\n";
    if (process.env.UPDATE_EFFECT_SETTINGS) writeFileSync(FILE, current);
    expect(readFileSync(FILE, "utf8"), "rerun with UPDATE_EFFECT_SETTINGS=1").toBe(current);
  });
});
