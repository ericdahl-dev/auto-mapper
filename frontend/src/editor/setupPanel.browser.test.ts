import { beforeEach, describe, expect, it, vi } from "vitest";
import html from "../../index.html?raw";
import { mountSetup } from "./setupPanel";
import type { SetupStep } from "./setupView";

// The Setup checklist (#168), on the Editor's real markup.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

beforeEach(() => {
  document.body.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, "");
});

describe("the Setup checklist's page", () => {
  it("is the sidebar's first section", () => {
    expect(document.querySelector("aside details.fold")!.getAttribute("data-fold")).toBe("setup");
    expect($("setup-steps").closest("[data-fold]")!.getAttribute("data-fold")).toBe("setup");
  });

  it("puts the camera picker with the camera's preview, checks and scan settings", () => {
    const camera = document.querySelector('[data-fold="camera"]')!;
    for (const id of ["camera-select", "preview-toggle", "check-framing", "calibrate", "hole-fill"]) {
      expect(camera.contains($(id)), id).toBe(true);
    }
  });
});

const steps: SetupStep[] = [
  { key: "projector", label: "Projector", state: "AML TV", level: "done", target: "projector-select", press: false },
  { key: "output", label: "Output window", state: "Open the output window", level: "todo", target: "open-output", press: true },
  { key: "camera", label: "Camera", state: "Choose a camera", level: "todo", target: "camera-select", press: false },
  { key: "framing", label: "Framing", state: "Not checked", level: "warn", target: "check-framing", press: true },
];

describe("the Setup checklist", () => {
  it("shows each step's state, in order", () => {
    mountSetup()(steps);
    const items = [...document.querySelectorAll("#setup-steps li")];
    expect(items.map((li) => li.querySelector(".setup-label")!.textContent)).toEqual(["Projector", "Output window", "Camera", "Framing"]);
    expect(items[1].querySelector(".setup-state")!.textContent).toBe("Open the output window");
    expect(items.map((li) => li.className)).toEqual(["done", "todo", "todo", "warn"]);
  });

  it("does a step with the real control: its label, and its disabled reason", () => {
    const open = vi.fn();
    $("open-output").addEventListener("click", open);
    $<HTMLButtonElement>("check-framing").disabled = true;
    $("check-framing").title = "Open the output window first";
    mountSetup()(steps);
    const button = (key: string) => document.querySelector<HTMLButtonElement>(`#setup-steps li[data-step="${key}"] button`)!;
    expect(button("output").textContent).toBe("Open output window");
    button("output").click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(button("framing").disabled).toBe(true);
    expect(button("framing").title).toBe("Open the output window first");
  });

  it("reveals a choice: opens its section and puts the focus on it", () => {
    mountSetup()(steps);
    const camera = document.querySelector<HTMLDetailsElement>('[data-fold="camera"]')!;
    camera.open = false;
    document.querySelector<HTMLButtonElement>('#setup-steps li[data-step="camera"] button')!.click();
    expect(camera.open).toBe(true);
    expect(document.activeElement).toBe($("camera-select"));
    expect(document.querySelector('#setup-steps li[data-step="camera"] button')!.getAttribute("aria-label")).toBe("Choose camera");
  });

  it("updates in place, so a click isn't lost to a redraw", () => {
    const render = mountSetup();
    render(steps);
    const first = document.querySelector("#setup-steps button");
    render([{ ...steps[0], state: "Other TV" }, ...steps.slice(1)]);
    expect(document.querySelector("#setup-steps button")).toBe(first);
    expect(document.querySelector("#setup-steps .setup-state")!.textContent).toBe("Other TV");
  });
});
