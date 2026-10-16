/**
 * The agent's background PDF-extraction jobs (the Background process page),
 * shared by every screen that shows their progress: one subscription for the
 * whole window, started on first use.
 */
import { useSyncExternalStore } from "react";
import type { ExtractionJobSummary } from "@shared/types/scanpack";

let jobs: ExtractionJobSummary[] = [];
let started = false;
const listeners = new Set<() => void>();

const set = (next: ExtractionJobSummary[]) => {
  jobs = next;
  listeners.forEach((listener) => listener());
};

const start = () => {
  if (started) return;
  started = true;
  // Subscribe first, so an update landing during the first read is not lost.
  window.printAgent.scanPack.onJobChanged(({ jobs: next }) => set(next));
  void window.printAgent.scanPack
    .listJobs()
    .then((result) => {
      if (result.ok) set(result.value);
    })
    .catch(() => undefined);
};

const subscribe = (listener: () => void) => {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useExtractionJobs = () => useSyncExternalStore(subscribe, () => jobs);

export const isActive = (job: ExtractionJobSummary) => job.state === "queued" || job.state === "running";

/** Records the job has dealt with, saved or not. */
export const handled = (job: ExtractionJobSummary) => job.counts.done + job.counts.missing + job.counts.failed;

/** The newest job per packlog. */
export const latestJobByPacklog = (list: ExtractionJobSummary[]) => {
  const map = new Map<string, ExtractionJobSummary>();
  for (const job of list) {
    const current = map.get(job.packlogObjectId);
    if (!current || job.createdAt > current.createdAt) map.set(job.packlogObjectId, job);
  }
  return map;
};
