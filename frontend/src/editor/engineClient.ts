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
    /** `gesture` groups saves into one undo step (a whole drag). */
    patchSurface: (id: number, body: SurfaceEdit & { effect?: string; name?: string }, gesture?: string) =>
      fetchFn(`/api/show/surfaces/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gesture ? { ...body, gesture } : body),
      }),
    // Scenes: looks on the same outlines
    addScene: (body: { name?: string; duplicate?: number }) => post("/api/show/scenes", body),
    updateScene: (id: number, body: { name?: string; duration?: number }) =>
      fetchFn(`/api/show/scenes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    openScene: (id: number) => post(`/api/show/scenes/${id}/open`),
    orderScenes: (ids: number[]) => post("/api/show/scenes/order", { ids }),
    deleteScene: (id: number) => fetchFn(`/api/show/scenes/${id}`, { method: "DELETE" }),
    setPlaylist: (body: { crossfade?: number; loop?: boolean }) => post("/api/show/playlist", body),
    undo: () => post("/api/show/undo"),
    redo: () => post("/api/show/redo"),
    select: (id: number | null) => post("/api/show/select", { id }),
    addSurface: (polygon: number[][]) => post("/api/show/surfaces", { polygon }),
    deleteSurface: (id: number) => fetchFn(`/api/show/surfaces/${id}`, { method: "DELETE" }),
    merge: (ids: number[]) => post("/api/show/merge", { ids }),
    applyEffect: (from: number, to?: number[]) => post("/api/show/apply", { from, ...(to ? { to } : {}) }),
    redetect: () => post("/api/show/redetect"),
    // Realigning the whole show (a bumped projector) and its master brightness
    align: (body: { corners?: number[][]; brightness?: number; gesture?: string }) => post("/api/show/alignment", body),
    resetAlignment: () => post("/api/show/alignment/reset"),
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
