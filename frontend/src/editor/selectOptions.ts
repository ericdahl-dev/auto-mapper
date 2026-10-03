// Fills a dropdown only when its options change, and never while it's open: replacing the options of
// an open menu closes it, and the Editor redraws on every status (every 2 s, faster with sound on).

export interface OptionSpec {
  value: string;
  label: string;
  selected?: boolean;
}

export function syncOptions(select: HTMLSelectElement, options: OptionSpec[]): void {
  const key = JSON.stringify(options);
  if (select.dataset.options === key || document.activeElement === select) return;
  select.dataset.options = key;
  select.replaceChildren(...options.map((o) => Object.assign(document.createElement("option"), o)));
}
