import { describe, expect, it } from "vitest";
import { initialScan, scanLabel, scanReducer } from "./scanState";

const RESULT = {
  type: "scan_result" as const,
  coverage: 0.874,
  seconds: 14.2,
  bit_reliability: {},
  image: "/api/scan/latest.png?t=1",
  width: 1920,
  height: 1080,
  surfaces: [
    { polygon: [[0, 0], [1920, 0], [1920, 1080], [0, 1080]], area: 2073600 },
    { polygon: [[1230, 880], [1540, 880], [1690, 1080], [1220, 1080]], area: 70000 },
  ],
};

describe("scanReducer", () => {
  it("tracks progress, then the result", () => {
    let s = scanReducer(initialScan, { type: "scan_started" });
    expect(scanLabel(s)).toBe("Scanning…");
    s = scanReducer(s, { type: "scan_progress", done: 23, total: 46 });
    expect(scanLabel(s)).toBe("Scanning… 50%");
    s = scanReducer(s, RESULT);
    expect(s.running).toBe(false);
    expect(s.image).toBe("/api/scan/latest.png?t=1");
    expect(scanLabel(s)).toBe("Coverage 87% · 14.2 s");
  });

  it("keeps the previous image when a scan fails", () => {
    const done = { ...initialScan, image: "/api/scan/latest.png?t=1" };
    const s = scanReducer(scanReducer(done, { type: "scan_started" }), { type: "scan_failed", error: "boom" });
    expect(s.running).toBe(false);
    expect(s.error).toBe("boom");
    expect(s.image).toBe("/api/scan/latest.png?t=1");
    expect(scanLabel(s)).toBe("Scan failed");
  });
});

