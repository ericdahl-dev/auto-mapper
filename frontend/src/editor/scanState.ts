import type { ScanMessage } from "../shared/messages";

export interface ScanState {
  running: boolean;
  done: number;
  total: number;
  image: string | null;
  coverage: number | null;
  seconds: number | null;
  error: string | null;
}

export const initialScan: ScanState = {
  running: false, done: 0, total: 0, image: null, coverage: null, seconds: null, error: null,
};

export function scanReducer(s: ScanState, msg: ScanMessage): ScanState {
  switch (msg.type) {
    case "scan_started":
      return { ...s, running: true, done: 0, total: 0, error: null };
    case "scan_progress":
      return { ...s, running: true, done: msg.done, total: msg.total };
    case "scan_result":
      return { ...s, running: false, image: msg.image, coverage: msg.coverage, seconds: msg.seconds };
    case "scan_failed":
      return { ...s, running: false, error: msg.error };
  }
}

export function scanLabel(s: ScanState): string {
  if (s.running) return s.total ? `Scanning… ${Math.round((100 * s.done) / s.total)}%` : "Scanning…";
  if (s.error) return "Scan failed";
  if (s.coverage !== null) return `Coverage ${Math.round(s.coverage * 100)}% · ${s.seconds} s`;
  return "No scan yet";
}
