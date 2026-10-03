import { describe, expect, it } from "vitest";
import html from "../../index.html?raw";

// Every control in the Editor's page says what it is to a screen reader (#124): an aria-label, a
// label element, aria-labelledby, or its own text. A title alone is only a tooltip.
function accessibleName(el: HTMLElement): string {
  const byId = (ids: string) => ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
  const own = el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") && byId(el.getAttribute("aria-labelledby")!));
  if (own) return own.trim();
  const labels = (el as HTMLInputElement).labels;
  if (labels?.length) return [...labels].map((l) => l.textContent ?? "").join(" ").trim();
  if (el instanceof HTMLButtonElement) return (el.textContent ?? "").trim();
  return "";
}

describe("the Editor page", () => {
  it("names every control", () => {
    document.body.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, "");
    const unnamed = [...document.querySelectorAll<HTMLElement>("input, select, button, meter, textarea")]
      .filter((el) => !accessibleName(el))
      .map((el) => el.id || el.outerHTML.slice(0, 60));
    expect(unnamed).toEqual([]);
  });
});
