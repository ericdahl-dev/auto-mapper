// Text params become textures: the string is drawn white on black on a canvas, and shaders use
// the red channel as a mask. The renderer keys these textures like media URLs, with a prefix.

export const TEXT_KEY = "text:";
const PX = 120; // font size the texture is drawn at
const FAMILIES: Record<string, string> = {
  sans: "system-ui, -apple-system, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, Menlo, Consolas, monospace",
};

export interface TextStyle {
  text: string;
  font: string; // a FAMILIES key
  align: "left" | "center" | "right";
}

export const textKey = (style: TextStyle) => TEXT_KEY + JSON.stringify(style);

/** Draws a text texture's canvas from its key. Empty text gives a 1x1 black canvas. */
export function drawText(key: string): HTMLCanvasElement {
  const style: TextStyle = JSON.parse(key.slice(TEXT_KEY.length));
  const c = document.createElement("canvas");
  const lines = style.text.split("\n");
  if (!style.text.trim()) {
    c.width = c.height = 1;
    return c;
  }
  const font = `bold ${PX}px ${FAMILIES[style.font] ?? FAMILIES.sans}`;
  const ctx = c.getContext("2d")!;
  ctx.font = font;
  const pad = PX * 0.1;
  const lineHeight = PX * 1.2;
  c.width = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + 2 * pad);
  c.height = Math.ceil(lines.length * lineHeight);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = font; // resizing the canvas reset it
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.textAlign = style.align;
  const x = style.align === "left" ? pad : style.align === "right" ? c.width - pad : c.width / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, (i + 0.5) * lineHeight));
  return c;
}
