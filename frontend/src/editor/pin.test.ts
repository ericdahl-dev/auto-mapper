import { describe, expect, it } from "vitest";
import { media } from "../effects/media";
import { fill } from "../effects/fill";
import { movePin, pinHandles } from "./pin";

const OUTLINE = [[260, 100], [420, 80], [440, 500], [90, 430], [100, 120]];
const CORNERS = [[100, 120], [420, 80], [440, 500], [90, 430]];

describe("pinHandles", () => {
  it("shows the outline's own corners when media is mapped to corners but not yet pinned", () => {
    expect(pinHandles(media, { fit: "corners" }, OUTLINE)).toEqual({ name: "corners", corners: CORNERS });
  });

  it("shows the saved pin once there is one", () => {
    const pin = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(pinHandles(media, { fit: "corners", corners: pin }, OUTLINE)?.corners).toEqual(pin);
  });

  it("shows nothing when the pin isn't in use: other fits, or effects without a pin", () => {
    expect(pinHandles(media, { fit: "cover" }, OUTLINE)).toBeNull();
    expect(pinHandles(media, {}, OUTLINE)).toBeNull(); // default fit is cover
    expect(pinHandles(fill, {}, OUTLINE)).toBeNull();
  });
});

describe("movePin", () => {
  it("moves one corner and leaves the others", () => {
    expect(movePin(CORNERS, 2, [450, 510])).toEqual([[100, 120], [420, 80], [450, 510], [90, 430]]);
  });
});
