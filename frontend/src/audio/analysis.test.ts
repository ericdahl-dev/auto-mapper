import { describe, expect, it } from "vitest";
import { AudioAnalyzer, bandLevels } from "./analysis";

const SAMPLE_RATE = 48000;
const BINS = 1024; // AnalyserNode with fftSize 2048: bin i covers i * 48000 / 2048 Hz (~23 Hz)

/** Byte frequency data (0..255 per bin) with energy only between two frequencies. */
function tone(fromHz: number, toHz: number, value = 255): Uint8Array {
  const data = new Uint8Array(BINS);
  const hz = SAMPLE_RATE / 2 / BINS;
  for (let i = 0; i < BINS; i++) if (i * hz >= fromHz && i * hz < toHz) data[i] = value;
  return data;
}

describe("bandLevels", () => {
  it("is all zero for silence", () => {
    expect(bandLevels(new Uint8Array(BINS), SAMPLE_RATE)).toEqual({ level: 0, bass: 0, mid: 0, treble: 0 });
  });

  it("puts a kick drum in bass, a voice in mid and cymbals in treble", () => {
    const kick = bandLevels(tone(40, 150), SAMPLE_RATE);
    expect(kick.bass).toBeGreaterThan(0.8);
    expect(kick.mid + kick.treble).toBe(0);
    const voice = bandLevels(tone(400, 2000), SAMPLE_RATE);
    expect(voice.mid).toBeGreaterThan(0.5);
    expect(voice.bass + voice.treble).toBe(0);
    const cymbal = bandLevels(tone(6000, 12000), SAMPLE_RATE);
    expect(cymbal.treble).toBeGreaterThan(0.5);
    expect(cymbal.bass + cymbal.mid).toBe(0);
  });

  it("level rises with loudness and stays within 0..1", () => {
    const quiet = bandLevels(tone(40, 12000, 60), SAMPLE_RATE).level;
    const loud = bandLevels(tone(40, 12000, 255), SAMPLE_RATE).level;
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
    expect(loud).toBeLessThanOrEqual(1);
  });
});

describe("AudioAnalyzer", () => {
  const frame = 1 / 60;

  it("smooths: rises quickly on a sound, falls slowly after it", () => {
    const a = new AudioAnalyzer(SAMPLE_RATE);
    const up = a.update(tone(40, 150), frame).bass;
    expect(up).toBeGreaterThan(0.3); // quick attack
    expect(up).toBeLessThan(1);
    let v = up;
    for (let i = 0; i < 10; i++) v = a.update(tone(40, 150), frame).bass;
    expect(v).toBeGreaterThan(0.8);
    const after = a.update(new Uint8Array(BINS), frame).bass;
    expect(after).toBeGreaterThan(0.5); // slow release: no flicker between beats
    expect(after).toBeLessThan(v);
  });

  it("pulses on a beat (a bass jump over the recent average) and decays", () => {
    const a = new AudioAnalyzer(SAMPLE_RATE);
    for (let i = 0; i < 60; i++) a.update(tone(40, 150, 40), frame); // steady quiet bass
    const hit = a.update(tone(40, 150, 255), frame).beat;
    expect(hit).toBeGreaterThan(0.9);
    let v = hit;
    for (let i = 0; i < 20; i++) v = a.update(tone(40, 150, 40), frame).beat;
    expect(v).toBeLessThan(0.3);
  });

  it("doesn't call a steady loud sound a beat", () => {
    const a = new AudioAnalyzer(SAMPLE_RATE);
    let beat = 0;
    for (let i = 0; i < 120; i++) beat = a.update(tone(40, 150, 200), frame).beat;
    expect(beat).toBeLessThan(0.1);
  });
});
