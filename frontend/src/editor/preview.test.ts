import { describe, expect, it } from "vitest";
import { previewStep } from "./preview";

const photo = () => new Response(new Blob(["jpg"], { type: "image/jpeg" }), { status: 200 });
const refusal = (detail: string) => new Response(JSON.stringify({ detail }), { status: 409 });

describe("one camera preview update", () => {
  it("shows a new photo and clears any note", async () => {
    const r = await previewStep(async () => photo());
    expect(r).toEqual({ photo: expect.any(Blob), note: "" });
  });

  it("keeps the last photo and says why when the camera refuses", async () => {
    const r = await previewStep(async () => refusal("The camera isn't answering. Turn it off and on."));
    expect(r).toEqual({ photo: null, note: "The camera isn't answering. Turn it off and on." });
  });

  it("says so when the engine can't be reached", async () => {
    const r = await previewStep(async () => { throw new TypeError("Failed to fetch"); });
    expect(r.photo).toBeNull();
    expect(r.note).toMatch(/engine/i);
  });
});
