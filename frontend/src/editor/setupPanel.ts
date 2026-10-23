// The Setup checklist's list (#168): one row per step, updated in place (a status arrives every 2 s,
// and a rebuilt button would lose a click). A step's button is its real control's: pressed, with
// that control's label and disabled reason, or, for a picker, its section opened and the focus put on it.

import type { SetupStep } from "./setupView";

export function mountSetup(): (steps: SetupStep[]) => void {
  const list = document.getElementById("setup-steps")!;
  const rows = new Map<string, { li: HTMLLIElement; state: HTMLElement; button: HTMLButtonElement }>();
  return (steps) => {
    for (const step of steps) {
      let row = rows.get(step.key);
      if (!row) {
        const li = document.createElement("li");
        li.dataset.step = step.key;
        const label = Object.assign(document.createElement("span"), { className: "setup-label", textContent: step.label });
        const state = Object.assign(document.createElement("span"), { className: "setup-state" });
        const button = document.createElement("button");
        button.addEventListener("click", () => act(step.target, step.press));
        li.append(label, button, state); // the state on its own line under them (index.html)
        list.append(li);
        row = { li, state, button };
        rows.set(step.key, row);
      }
      const target = document.getElementById(step.target) as HTMLButtonElement;
      row.li.className = step.level;
      row.state.textContent = step.state;
      row.button.textContent = step.press ? target.textContent : "Choose";
      row.button.disabled = step.press && target.disabled;
      row.button.title = step.press ? target.title : "";
    }
  };
}

function act(id: string, press: boolean) {
  const target = document.getElementById(id)!;
  if (press) return target.click();
  const fold = target.closest("details");
  if (fold) fold.open = true;
  target.scrollIntoView({ block: "nearest" });
  target.focus();
}
