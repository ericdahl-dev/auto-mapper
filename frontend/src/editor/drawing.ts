// Drawing a surface by hand: click corners on the scan, double-click (or Enter) to finish.

type Pt = number[];

export interface DrawState {
  active: boolean;
  points: Pt[];
  finished: Pt[] | null; // set once, when a polygon is completed
}

export const idleDraw: DrawState = { active: false, points: [], finished: null };

export type DrawEvent =
  | { type: "start" }
  | { type: "point"; point: Pt }
  | { type: "finish" }
  | { type: "cancel" };

const NEAR_PX = 3; // a second click this close to the last point is the double-click's echo

export function drawStep(s: DrawState, ev: DrawEvent): DrawState {
  switch (ev.type) {
    case "start":
      return { active: true, points: [], finished: null };
    case "cancel":
      return idleDraw;
    case "point": {
      if (!s.active) return s;
      const last = s.points[s.points.length - 1];
      if (last && Math.hypot(last[0] - ev.point[0], last[1] - ev.point[1]) < NEAR_PX) return s;
      return { ...s, points: [...s.points, ev.point], finished: null };
    }
    case "finish":
      if (!s.active || s.points.length < 3) return { ...s, finished: null };
      return { active: false, points: [], finished: s.points };
  }
}
