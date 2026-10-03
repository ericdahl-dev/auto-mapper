// Sending a video's sound to one channel of the output: all channels as it is, the left or right
// speaker, a pan in between, or channel k of a multichannel audio interface. Left, right and channel k
// get a mono mix of the soundtrack, so a hard left is left only.

export interface ChannelChoice {
  channel: string; // "all", "left", "right", "pan", or "1".."N"
  pan: number; // -1 (left) .. 1 (right), for "pan"
  channels: number; // how many channels the output has
}

/** Connects `source` to `out` on the chosen channel. Returns the node `source` was connected to, so it
 *  can be disconnected from it to route it again. */
export function routeToChannel(ctx: BaseAudioContext, source: AudioNode, out: AudioNode, c: ChannelChoice): AudioNode {
  if (c.channel === "pan") {
    const panner = new StereoPannerNode(ctx, { pan: Math.max(-1, Math.min(1, c.pan)) });
    source.connect(panner).connect(out);
    return panner;
  }
  const index = c.channel === "left" ? 0 : c.channel === "right" ? 1 : Number(c.channel) - 1;
  const slots = Math.max(2, c.channels);
  if (c.channel === "all" || !Number.isInteger(index) || index < 0 || index >= slots) {
    source.connect(out);
    return out;
  }
  const mono = new GainNode(ctx, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers" });
  const merger = new ChannelMergerNode(ctx, { numberOfInputs: slots });
  source.connect(mono);
  mono.connect(merger, 0, index);
  merger.connect(out);
  return mono;
}
