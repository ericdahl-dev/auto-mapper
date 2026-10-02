// Turns an AnalyserNode's byte frequency data into a few 0..1 values for shaders:
// overall level, bass/mid/treble, and a beat pulse.

export interface Bands {
  level: number;
  bass: number;
  mid: number;
  treble: number;
}
export interface AudioValues extends Bands {
  beat: number;
}
export const SILENT: AudioValues = { level: 0, bass: 0, mid: 0, treble: 0, beat: 0 };

const BANDS: [keyof Omit<Bands, "level">, number, number][] = [
  ["bass", 20, 250],
  ["mid", 250, 4000],
  ["treble", 4000, 16000],
];

/** Each band's strength: the 80th-percentile bin (so a sound filling part of a band still reads
 *  as strong), scaled to 0..1. Level is the bands' mean. */
export function bandLevels(data: Uint8Array, sampleRate: number): Bands {
  const hz = sampleRate / 2 / data.length;
  const out: Bands = { level: 0, bass: 0, mid: 0, treble: 0 };
  for (const [name, lo, hi] of BANDS) {
    const bins: number[] = [];
    for (let i = Math.ceil(lo / hz); i * hz < hi && i < data.length; i++) bins.push(data[i]);
    if (!bins.length) continue;
    bins.sort((a, b) => a - b);
    out[name] = bins[Math.min(bins.length - 1, Math.floor(bins.length * 0.8))] / 255;
  }
  out.level = (out.bass + out.mid + out.treble) / 3;
  return out;
}

const ATTACK = 0.03; // seconds: rise fast with a sound...
const RELEASE = 0.3; // ...fall slowly, so effects don't flicker between notes
const AVERAGE = 1; // seconds of bass history a beat must stand out from
const BEAT_DECAY = 0.15;
const BEAT_GAP = 0.25; // at most 4 beats a second

/** Smoothed band values plus beat detection, updated once per frame. */
export class AudioAnalyser {
  private v: AudioValues = { ...SILENT };
  private bassAverage = 0;
  private sinceBeat = Infinity;

  constructor(private sampleRate: number) {}

  update(data: Uint8Array, dt: number): AudioValues {
    const raw = bandLevels(data, this.sampleRate);
    for (const k of ["level", "bass", "mid", "treble"] as const) {
      const tau = raw[k] > this.v[k] ? ATTACK : RELEASE;
      this.v[k] += (raw[k] - this.v[k]) * (1 - Math.exp(-dt / tau));
    }
    // A beat: bass well above its recent average.
    this.sinceBeat += dt;
    if (raw.bass > this.bassAverage * 1.4 + 0.1 && this.sinceBeat >= BEAT_GAP) {
      this.v.beat = 1;
      this.sinceBeat = 0;
    } else {
      this.v.beat *= Math.exp(-dt / BEAT_DECAY);
    }
    this.bassAverage += (raw.bass - this.bassAverage) * (1 - Math.exp(-dt / AVERAGE));
    return { ...this.v };
  }
}
