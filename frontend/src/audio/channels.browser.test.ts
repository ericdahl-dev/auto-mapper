import { describe, expect, it } from "vitest";
import { routeToChannel } from "./channels";

const RATE = 8000;

/** Renders tones routed by `route` into a context with `channels` outputs; returns each channel's RMS. */
async function render(channels: number, route: (ctx: OfflineAudioContext, out: AudioNode) => void): Promise<number[]> {
  const ctx = new OfflineAudioContext(channels, RATE / 4, RATE);
  ctx.destination.channelCount = channels;
  ctx.destination.channelCountMode = "explicit";
  ctx.destination.channelInterpretation = "discrete";
  route(ctx, ctx.destination);
  const buf = await ctx.startRendering();
  return Array.from({ length: channels }, (_, c) => {
    const d = buf.getChannelData(c);
    return Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
  });
}

/** A stereo tone (the same on both sides, like a video's soundtrack). */
function tone(ctx: BaseAudioContext, hz: number): AudioNode {
  const osc = new OscillatorNode(ctx, { frequency: hz });
  const stereo = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  osc.connect(stereo, 0, 0);
  osc.connect(stereo, 0, 1);
  osc.start();
  return stereo;
}

describe("sending a video's sound to a channel", () => {
  it("All plays it as it is", async () => {
    const [l, r] = await render(2, (ctx, out) => routeToChannel(ctx, tone(ctx, 110), out, { channel: "all", pan: 0, channels: 2 }));
    expect(l).toBeGreaterThan(0.3);
    expect(r).toBeGreaterThan(0.3);
  });

  it("Left and Right put each video on its own side only", async () => {
    const [l, r] = await render(2, (ctx, out) => {
      routeToChannel(ctx, tone(ctx, 110), out, { channel: "left", pan: 0, channels: 2 });
    });
    expect(l).toBeGreaterThan(0.3);
    expect(r).toBeLessThan(0.001);
    const [l2, r2] = await render(2, (ctx, out) => routeToChannel(ctx, tone(ctx, 440), out, { channel: "right", pan: 0, channels: 2 }));
    expect(l2).toBeLessThan(0.001);
    expect(r2).toBeGreaterThan(0.3);
  });

  it("Pan places it in between", async () => {
    const [l, r] = await render(2, (ctx, out) => routeToChannel(ctx, tone(ctx, 110), out, { channel: "pan", pan: 0.5, channels: 2 }));
    expect(r).toBeGreaterThan(l);
    expect(l).toBeGreaterThan(0.01);
  });

  it("on a multichannel output, channel k gets video k and nothing else", async () => {
    const rms = await render(4, (ctx, out) => {
      routeToChannel(ctx, tone(ctx, 110), out, { channel: "3", pan: 0, channels: 4 });
    });
    expect(rms[2]).toBeGreaterThan(0.3); // channel 3 is the third output
    expect(rms[0] + rms[1] + rms[3]).toBeLessThan(0.001);
  });
});
