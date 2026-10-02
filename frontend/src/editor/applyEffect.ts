/** What "apply this effect" targets: the shift-selected surfaces if any, otherwise all. */
export function applyPlan(fromId: number, multi: Set<number>, total: number): { to: number[] | undefined; label: string } {
  const others = [...multi].filter((id) => id !== fromId);
  if (others.length > 0) return { to: others, label: `Apply to ${others.length} selected` };
  return { to: undefined, label: `Apply to all ${total} surfaces` };
}
