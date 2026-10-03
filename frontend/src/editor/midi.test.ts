import { describe, expect, it } from "vitest";
import { media } from "../effects/media";
import { MidiRouter, parseMidi, settingValue, type MidiBinding } from "./midi";

const zoom = media.params.find((p) => p.name === "zoom")!; // 0.1 .. 10
const fit = media.params.find((p) => p.name === "fit")!;

describe("reading MIDI messages", () => {
  it("reads knobs (CC) and keys (note on), on their channel", () => {
    expect(parseMidi([0xb0, 21, 64])).toEqual({ kind: "cc", channel: 0, number: 21, value: 64 });
    expect(parseMidi([0x99, 36, 100])).toEqual({ kind: "note", channel: 9, number: 36, value: 100 });
  });

  it("ignores note off (and note on with no velocity) and other messages", () => {
    expect(parseMidi([0x89, 36, 0])).toBeNull();
    expect(parseMidi([0x99, 36, 0])).toBeNull();
    expect(parseMidi([0xf8])).toBeNull(); // clock
  });
});

describe("a knob's position as a setting's value", () => {
  it("spans a number setting's range", () => {
    expect(settingValue(zoom, 0)).toBeCloseTo(0.1);
    expect(settingValue(zoom, 127)).toBeCloseTo(10);
  });

  it("picks one of a choice's options", () => {
    if (fit.type !== "choice") throw new Error("fit is a choice");
    expect(settingValue(fit, 0)).toBe(fit.options[0].value);
    expect(settingValue(fit, 127)).toBe(fit.options[fit.options.length - 1].value);
  });
});

describe("routing MIDI to bindings", () => {
  const knob: MidiBinding = { kind: "cc", channel: 0, number: 21, target: { surface: 1, param: "zoom" } };
  const pad: MidiBinding = { kind: "note", channel: 9, number: 36, target: { action: "blackout" } };
  const fader: MidiBinding = { kind: "cc", channel: 0, number: 7, target: { action: "next" } };

  it("learns the next knob or key for the armed target", () => {
    const r = new MidiRouter();
    r.arm({ surface: 1, param: "zoom" });
    expect(r.receive(parseMidi([0xb0, 21, 10])!, [])).toEqual({ learned: knob });
    expect(r.armed).toBeNull();
  });

  it("sends bound knobs to their setting, and fires actions once per press", () => {
    const r = new MidiRouter();
    expect(r.receive(parseMidi([0xb0, 21, 127])!, [knob])).toEqual({ setting: { surface: 1, param: "zoom", value: 127 } });
    expect(r.receive(parseMidi([0x99, 36, 90])!, [pad])).toEqual({ action: "blackout" });
    // A CC bound to an action fires when it goes past halfway, not on every step after that.
    expect(r.receive(parseMidi([0xb0, 7, 100])!, [fader])).toEqual({ action: "next" });
    expect(r.receive(parseMidi([0xb0, 7, 110])!, [fader])).toBeNull();
    expect(r.receive(parseMidi([0xb0, 7, 10])!, [fader])).toBeNull();
    expect(r.receive(parseMidi([0xb0, 7, 90])!, [fader])).toEqual({ action: "next" });
    expect(r.receive(parseMidi([0xb0, 22, 90])!, [knob])).toBeNull(); // not bound
  });
});
