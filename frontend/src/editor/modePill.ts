// The header's mode pill: what the projector is doing right now, at a glance.

export function modePill(p: { mode: "edit" | "play"; blackout: boolean } | undefined): { text: string; kind: "edit" | "live" | "dark" | "none" } {
  if (!p) return { text: "", kind: "none" };
  if (p.blackout) return { text: "BLACKOUT", kind: "dark" };
  return p.mode === "play" ? { text: "PLAYING", kind: "live" } : { text: "EDIT", kind: "edit" };
}
