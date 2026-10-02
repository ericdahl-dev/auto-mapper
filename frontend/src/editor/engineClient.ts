// Every call the Editor makes to the engine, in one place: routes, methods and body shapes.
// See docs/http-api.md. Each call returns the Response; callers check it where they need to.

import type { TestFrameKind } from "../shared/messages";
import type { SurfaceEdit } from "./editSession";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function createEngineClient(fetchFn: Fetch = (url, init) => fetch(url, init)) {
  const get = (url: string) => fetchFn(url);
  const post = (url: string, body?: unknown) =>
    fetchFn(url, body === undefined
      ? { method: "POST" }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  return {
    // The current show's surfaces
    patchSurface: (id: number, body: SurfaceEdit & { effect?: string; name?: string }) =>
      fetchFn(`/api/scene/surfaces/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    select: (id: number | null) => post("/api/scene/select", { id }),
    addSurface: (polygon: number[][]) => post("/api/scene/surfaces", { polygon }),
    deleteSurface: (id: number) => fetchFn(`/api/scene/surfaces/${id}`, { method: "DELETE" }),
    merge: (ids: number[]) => post("/api/scene/merge", { ids }),
    applyEffect: (from: number, to?: number[]) => post("/api/scene/apply", { from, ...(to ? { to } : {}) }),
    redetect: () => post("/api/scene/redetect"),
    uploadMedia: (file: File) => fetchFn(`/api/media?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file }),
    // Sound
    sound: (body: { enabled?: boolean; device?: string; source?: string; output?: string }) => post("/api/sound", body),
    // Scans, camera and hardware
    startScan: () => post("/api/scan"),
    cancelScan: () => post("/api/scan/cancel"),
    latestScan: () => get("/api/scan/latest"),
    calibrate: () => post("/api/camera/calibrate"),
    releaseCamera: () => post("/api/camera/release"),
    selectCamera: (uniqueId: string) => post("/api/camera", { unique_id: uniqueId }),
    selectProjector: (key: string) => post("/api/projector", { key }),
    refreshHardware: () => post("/api/hardware/refresh"),
    testFrame: (kind: TestFrameKind) => post("/api/test-frame", { kind }),
    // Projects
    projects: () => get("/api/projects"),
    saveProject: (name: string) => post("/api/projects", { name }),
    openProject: (slug: string) => post(`/api/projects/${slug}/open`),
  };
}

export type EngineClient = ReturnType<typeof createEngineClient>;
