/**
 * AGENT ADDITION: timing for the Scan & Pack upload, per record and per step.
 *
 * Every line goes to the DevTools console AND to the app's terminal (via the
 * main process, which also keeps it in agent.log):
 *
 *   [scanpack:time] For record 3 (FMPC6419156619) 412 ms taken in scan: barcode decode (2x)
 *   [scanpack:time] ── Totals ── scan: 4 812 ms · prepare: 96 ms · save: 41 ms
 *
 * Lines are batched every 250 ms and sent one-way, so logging never waits on
 * the main process and cannot slow down what it measures.
 */
const buffer: string[] = [];
let timer: number | null = null;

const flush = () => {
  timer = null;
  if (!buffer.length) return;
  const lines = buffer.splice(0, buffer.length);
  try {
    window.printAgent.scanPack.perf(lines);
  } catch (err) {
    // Timing is diagnostic only; losing it must never break an upload.
    console.warn("[scanpack:time] could not forward timing lines", err);
  }
};

export const perfLog = (line: string): void => {
  console.info(`[scanpack:time] ${line}`);
  buffer.push(line);
  timer ??= window.setTimeout(flush, 250);
};

/** Send everything buffered now (end of an upload). */
export const perfFlush = (): void => {
  if (timer !== null) window.clearTimeout(timer);
  flush();
};

export const now = (): number => performance.now();
export const elapsed = (start: number): number => Math.round(performance.now() - start);

/** "For record 3 (AWB)" / "For page 7" — the prefix every per-record line starts with. */
export const recordLabel = (kind: "record" | "page", n: number, awb?: string | null): string =>
  `For ${kind} ${n}${awb ? ` (${awb})` : ""}`;

/** Per-stage running totals for one upload, printed at the end. */
export class StageTotals {
  private readonly totals = new Map<string, { ms: number; count: number }>();
  private readonly started = performance.now();

  add(stage: string, ms: number): void {
    const entry = this.totals.get(stage) ?? { ms: 0, count: 0 };
    entry.ms += ms;
    entry.count += 1;
    this.totals.set(stage, entry);
  }

  print(title: string): void {
    const total = Math.round(performance.now() - this.started);
    perfLog(`── ${title}: ${total} ms end to end ──`);
    for (const [stage, { ms, count }] of [...this.totals.entries()].sort((a, b) => b[1].ms - a[1].ms)) {
      const share = total ? Math.round((ms / total) * 100) : 0;
      perfLog(`   ${stage}: ${Math.round(ms)} ms total over ${count} step(s), avg ${Math.round(ms / count)} ms, ~${share}% of the time`);
    }
    perfFlush();
  }
}
