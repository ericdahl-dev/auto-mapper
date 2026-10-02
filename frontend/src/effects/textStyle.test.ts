import { describe, expect, it } from "vitest";
import { text } from "./text";
import type { Effect } from "./types";
import { textSources } from "./types";

const key = (s: Record<string, string>) => JSON.parse(Object.values(s)[0].slice("text:".length));

describe("text style role", () => {
  it("the Text effect's font and align settings style its text", () => {
    expect(key(textSources(text, { text: "Hi", font: "mono", align: "left" }))).toEqual({ text: "Hi", font: "mono", align: "left" });
  });

  it("follows the effect's declared settings, whatever they're called", () => {
    const sign: Effect = {
      id: "sign", name: "Sign", fragment: "void main() { color = vec4(1.0); }",
      params: [
        { name: "words", label: "Words", type: "text", default: "Open" },
        { name: "typeface", label: "Typeface", type: "choice", default: "serif", options: [{ value: "serif", label: "Serif" }, { value: "mono", label: "Mono" }] },
        { name: "justify", label: "Justify", type: "choice", default: "right", options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }] },
      ],
      textStyle: { font: "typeface", align: "justify" },
    };
    expect(key(textSources(sign, { typeface: "mono" }))).toEqual({ text: "Open", font: "mono", align: "right" });
  });

  it("uses sans and centered for effects without a text style", () => {
    const plain: Effect = { id: "p", name: "P", fragment: null, params: [{ name: "t", label: "T", type: "text", default: "x" }] };
    expect(key(textSources(plain, {}))).toEqual({ text: "x", font: "sans", align: "center" });
  });
});
