import { describe, expect, it } from "vitest";
import { syncOptions } from "./selectOptions";

const opts = (...values: string[]) => values.map((v) => ({ value: v, label: `Item ${v}`, selected: v === "b" }));

describe("filling a dropdown", () => {
  it("leaves it alone when its options haven't changed, so an open menu stays open", () => {
    const select = document.createElement("select");
    syncOptions(select, opts("a", "b"));
    const first = select.options[0];
    syncOptions(select, opts("a", "b"));
    expect(select.options[0]).toBe(first);
    expect(select.value).toBe("b");
  });

  it("rebuilds it when they change", () => {
    const select = document.createElement("select");
    syncOptions(select, opts("a", "b"));
    syncOptions(select, opts("a", "b", "c"));
    expect([...select.options].map((o) => o.value)).toEqual(["a", "b", "c"]);
  });

  it("waits while it's open (focused) and catches up after", () => {
    const select = document.createElement("select");
    document.body.append(select);
    syncOptions(select, opts("a", "b"));
    select.focus();
    syncOptions(select, opts("a", "b", "c"));
    expect(select.options.length).toBe(2);
    select.blur();
    syncOptions(select, opts("a", "b", "c"));
    expect(select.options.length).toBe(3);
    select.remove();
  });
});
