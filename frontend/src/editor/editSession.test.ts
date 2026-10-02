import { describe, expect, it } from "vitest";
import type { ShowMessage } from "../shared/messages";
import { EditSession } from "./editSession";

const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10]];

function show(over: { polygon?: number[][]; params?: Record<string, unknown> } = {}, id = 1): ShowMessage {
  return {
    type: "show", width: 100, height: 100, selected: null, presentation: { mode: "edit", blackout: false },
    surfaces: [{ id, polygon: over.polygon ?? SQUARE, area: 100, effect: "media", params: over.params ?? {} }],
  };
}

/** A session with a manual frame clock and a log of the PATCHes it sends. */
function setup() {
  const sent: [number, object][] = [];
  let queued: (() => void)[] = [];
  const session = new EditSession({
    patch: (id, body) => sent.push([id, body]),
    nextFrame: (fn) => queued.push(fn),
  });
  const frame = () => {
    const run = queued;
    queued = [];
    run.forEach((fn) => fn());
  };
  const seen: ShowMessage[] = [];
  session.subscribe((s) => seen.push(s));
  return { session, sent, frame, seen };
}

describe("EditSession saving", () => {
  it("sends one PATCH per frame per surface for settings, with the latest values merged", () => {
    const { session, sent, frame } = setup();
    session.receive(show());
    session.edit(1, { params: { panX: 0.1 } });
    session.edit(1, { params: { panX: 0.2 } });
    session.edit(1, { params: { zoom: 2 } });
    expect(sent).toEqual([]); // nothing until the frame
    frame();
    expect(sent).toEqual([[1, { params: { panX: 0.2, zoom: 2 } }]]);
  });

  it("doesn't let one kind of edit cancel another: shape and settings, or two surfaces", () => {
    const { session, sent, frame } = setup();
    session.receive({ ...show(), surfaces: [...show().surfaces, ...show({}, 2).surfaces] });
    session.edit(1, { polygon: [[1, 1], [9, 1], [5, 9]] });
    session.edit(1, { params: { text: "Hi" } });
    session.edit(2, { params: { zoom: 3 } });
    frame();
    expect(sent).toContainEqual([1, { polygon: [[1, 1], [9, 1], [5, 9]] }]);
    expect(sent).toContainEqual([1, { params: { text: "Hi" } }]);
    expect(sent).toContainEqual([2, { params: { zoom: 3 } }]);
    expect(sent).toHaveLength(3);
  });

  it("sends a shape edit with its Bezier together", () => {
    const { session, sent, frame } = setup();
    session.receive(show());
    const bezier = { anchors: SQUARE, controls: {} };
    session.edit(1, { polygon: SQUARE, bezier });
    frame();
    expect(sent).toEqual([[1, { polygon: SQUARE, bezier }]]);
  });

  it("sends pending edits straight away when a gesture ends", () => {
    const { session, sent } = setup();
    session.receive(show());
    session.begin();
    session.edit(1, { polygon: [[2, 2], [8, 2], [5, 8]] });
    session.end();
    expect(sent).toEqual([[1, { polygon: [[2, 2], [8, 2], [5, 8]] }]]);
  });
});

describe("EditSession surface edge", () => {
  it("shows an edge change at once and saves the latest one per frame", () => {
    const { session, sent, frame } = setup();
    session.receive(show());
    session.edit(1, { edge: -2 });
    session.edit(1, { edge: -4 });
    expect(session.surface(1)?.edge).toBe(-4);
    frame();
    expect(sent).toEqual([[1, { edge: -4 }]]);
  });
});

describe("EditSession undo steps", () => {
  /** A session that records each save's gesture id, with a clock the test moves. */
  function steps() {
    const gestures: string[] = [];
    let queued: (() => void)[] = [];
    let now = 0;
    const session = new EditSession({
      patch: (_id, _body, gesture) => gestures.push(gesture),
      nextFrame: (fn) => queued.push(fn),
      now: () => now,
    });
    session.receive(show());
    const frame = () => { const run = queued; queued = []; run.forEach((fn) => fn()); };
    return { session, gestures, frame, wait: (ms: number) => { now += ms; } };
  }

  it("marks every save of one drag with the same gesture, and the next drag with another", () => {
    const { session, gestures, frame } = steps();
    session.begin();
    session.edit(1, { polygon: [[1, 1], [9, 1], [5, 9]] });
    frame();
    session.edit(1, { polygon: [[2, 2], [9, 1], [5, 9]] });
    session.end();
    session.begin();
    session.edit(1, { params: { zoom: 2 } });
    session.end();
    expect(gestures[0]).toBe(gestures[1]);
    expect(gestures[2]).not.toBe(gestures[0]);
  });

  it("groups edits outside a drag (typing, a slider) until a short pause", () => {
    const { session, gestures, frame, wait } = steps();
    session.edit(1, { params: { text: "H" } });
    frame();
    wait(300);
    session.edit(1, { params: { text: "Hi" } });
    frame();
    wait(2000);
    session.edit(1, { params: { text: "Hi!" } });
    frame();
    expect(gestures[0]).toBe(gestures[1]);
    expect(gestures[2]).not.toBe(gestures[1]);
  });
});

describe("EditSession local view", () => {
  it("shows edits straight away, so the next edit builds on them (e.g. fast wheel zoom)", () => {
    const { session } = setup();
    session.receive(show({ params: { zoom: 1 } }));
    session.edit(1, { params: { zoom: 1.5 } });
    expect(session.surface(1)?.params.zoom).toBe(1.5);
    session.edit(1, { params: { zoom: (session.surface(1)?.params.zoom as number) * 1.5 } });
    expect(session.surface(1)?.params.zoom).toBe(2.25);
  });

  it("goes back to the engine's values once its saves are confirmed", () => {
    const { session, frame } = setup();
    session.receive(show({ params: { zoom: 1 } }));
    session.edit(1, { params: { zoom: 2 } });
    frame(); // sent
    session.receive(show({ params: { zoom: 2 } })); // the engine's echo
    session.receive(show({ params: { zoom: 4 } })); // another editor changed it
    expect(session.surface(1)?.params.zoom).toBe(4);
  });

  it("keeps an edit not yet sent on top of an incoming show", () => {
    const { session } = setup();
    session.receive(show({ params: { zoom: 1 } }));
    session.edit(1, { params: { zoom: 3 } }); // not sent yet
    session.receive(show({ params: { zoom: 1, panX: 0.5 } }));
    expect(session.surface(1)?.params).toMatchObject({ zoom: 3, panX: 0.5 });
  });
});

describe("EditSession gestures", () => {
  it("applies a show that arrives when idle straight away", () => {
    const { session, seen } = setup();
    session.receive(show());
    expect(seen).toHaveLength(1);
  });

  it("holds show updates that arrive during a gesture and applies only the latest when it ends, through the same path", () => {
    const { session, seen } = setup();
    session.receive(show());
    session.begin();
    session.receive(show({ polygon: [[0, 0], [20, 0], [20, 20]] }));
    session.receive(show({ polygon: [[0, 0], [30, 0], [30, 30]] }));
    expect(seen).toHaveLength(1); // nothing rebuilt under the pointer
    session.end();
    expect(seen).toHaveLength(2);
    expect(seen[1].surfaces[0].polygon).toEqual([[0, 0], [30, 0], [30, 30]]);
  });

  it("knows whether a gesture is in progress", () => {
    const { session } = setup();
    expect(session.busy).toBe(false);
    session.begin();
    expect(session.busy).toBe(true);
    session.end();
    expect(session.busy).toBe(false);
  });
});
