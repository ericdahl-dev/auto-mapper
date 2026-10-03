// The Editor's schedule section: the next on or off time, in words.

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Turns on today at 17:30", from the engine's next change (local time, ISO without zone). */
export function nextChangeText(next: { at: string; on: boolean } | null, now: Date): string {
  if (!next) return "Schedule off";
  const at = new Date(next.at);
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(at) - midnight(now)) / 86_400_000);
  const day = days === 0 ? "today" : days === 1 ? "tomorrow" : DAYS[at.getDay()];
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  return `Turns ${next.on ? "on" : "off"} ${day} at ${time}`;
}
