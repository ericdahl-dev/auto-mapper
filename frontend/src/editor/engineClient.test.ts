import { describe, expect, it } from "vitest";
import { createEngineClient } from "./engineClient";

/** A client whose fetch records each request instead of sending it. */
function setup() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const client = createEngineClient(async (url, init) => {
    const body = init?.body;
    calls.push({ url: String(url), method: init?.method ?? "GET", body: typeof body === "string" ? JSON.parse(body) : body });
    return new Response("{}");
  });
  return { client, calls };
}

describe("engine client", () => {
  it("sends each action to its engine route with a JSON body", async () => {
    const { client, calls } = setup();
    await client.patchSurface(3, { params: { zoom: 2 } });
    await client.select(3);
    await client.select(null);
    await client.addSurface([[0, 0], [1, 0], [0, 1]]);
    await client.deleteSurface(3);
    await client.merge([1, 2]);
    await client.applyEffect(1, [2, 3]);
    await client.applyEffect(1);
    await client.redetect();
    await client.sound({ enabled: true, source: "video" });
    await client.selectProjector("hdmi");
    await client.selectCamera("0x211");
    await client.testFrame("grid");
    await client.saveProject("Porch");
    await client.openProject("porch");
    expect(calls).toEqual([
      { url: "/api/scene/surfaces/3", method: "PATCH", body: { params: { zoom: 2 } } },
      { url: "/api/scene/select", method: "POST", body: { id: 3 } },
      { url: "/api/scene/select", method: "POST", body: { id: null } },
      { url: "/api/scene/surfaces", method: "POST", body: { polygon: [[0, 0], [1, 0], [0, 1]] } },
      { url: "/api/scene/surfaces/3", method: "DELETE", body: undefined },
      { url: "/api/scene/merge", method: "POST", body: { ids: [1, 2] } },
      { url: "/api/scene/apply", method: "POST", body: { from: 1, to: [2, 3] } },
      { url: "/api/scene/apply", method: "POST", body: { from: 1 } },
      { url: "/api/scene/redetect", method: "POST", body: undefined },
      { url: "/api/sound", method: "POST", body: { enabled: true, source: "video" } },
      { url: "/api/projector", method: "POST", body: { key: "hdmi" } },
      { url: "/api/camera", method: "POST", body: { unique_id: "0x211" } },
      { url: "/api/test-frame", method: "POST", body: { kind: "grid" } },
      { url: "/api/projects", method: "POST", body: { name: "Porch" } },
      { url: "/api/projects/porch/open", method: "POST", body: undefined },
    ]);
  });

  it("covers the scan, camera and hardware actions", async () => {
    const { client, calls } = setup();
    await client.startScan();
    await client.cancelScan();
    await client.latestScan();
    await client.calibrate();
    await client.releaseCamera();
    await client.refreshHardware();
    await client.projects();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/scan", "POST /api/scan/cancel", "GET /api/scan/latest", "POST /api/camera/calibrate",
      "POST /api/camera/release", "POST /api/hardware/refresh", "GET /api/projects",
    ]);
  });

  it("uploads media as the raw file with its name in the query", async () => {
    const { client, calls } = setup();
    const file = new File(["x"], "my wall.png", { type: "image/png" });
    await client.uploadMedia(file);
    expect(calls[0].url).toBe("/api/media?name=my%20wall.png");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toBe(file);
  });
});
