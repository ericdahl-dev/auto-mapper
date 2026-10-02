import { describe, expect, it } from "vitest";
import type { StatusMessage } from "../shared/messages";
import { describeStatus } from "./statusView";

function status(over: Partial<StatusMessage> = {}, issues: StatusMessage["hardware"]["issues"] = []): StatusMessage {
  return {
    type: "status",
    hardware: {
      projector: issues.includes("no_projector") ? null : { name: "AML TV", width: 1920, height: 1080 },
      cameras: issues.includes("no_camera") ? [] : ["Webcam AC410"],
      issues,
    },
    output_connected: true,
    output_resolution: { width: 1920, height: 1080 },
    can_scan: issues.length === 0,
    ...over,
  };
}

describe("describeStatus", () => {
  it("is ready with no banners when everything is connected", () => {
    const view = describeStatus(status());
    expect(view.banners).toEqual([]);
    expect(view.scanEnabled).toBe(true);
    expect(view.output).toBe("Output connected (1920×1080)");
    expect(view.projector).toBe("AML TV (1920×1080)");
  });

  it("explains a missing projector and disables scan", () => {
    const view = describeStatus(status({}, ["no_projector"]));
    expect(view.banners).toContain("No projector detected. Connect it as an extended display, then refresh hardware.");
    expect(view.scanEnabled).toBe(false);
  });

  it("explains a missing camera and disables scan", () => {
    const view = describeStatus(status({}, ["no_camera"]));
    expect(view.banners).toContain("No camera detected. Plug in the webcam, then refresh hardware.");
    expect(view.scanEnabled).toBe(false);
  });

  it("asks for the output window when it is not connected", () => {
    const view = describeStatus(status({ output_connected: false, output_resolution: null, can_scan: false }));
    expect(view.banners).toContain("Output window not connected. Open it and move it fullscreen onto the projector.");
    expect(view.output).toBe("Output not connected");
    expect(view.scanEnabled).toBe(false);
  });

  it("warns when the output window size does not match the projector", () => {
    const view = describeStatus(status({ output_resolution: { width: 1280, height: 720 } }));
    expect(view.banners).toContain("Output window is 1280×720 but the projector is 1920×1080. Make it fullscreen on the projector.");
  });

  it("reports a lost engine connection", () => {
    const view = describeStatus(null);
    expect(view.banners).toEqual(["Engine not reachable. Is `make dev` running?"]);
    expect(view.scanEnabled).toBe(false);
  });
});
