/**
 * Packlog work that runs in the background: creating a packlog from Label
 * Sorting, and downloading a packlog's labels in its sorted order.
 *
 * Lives at module level, not in a page, so it keeps running when the operator
 * moves to another sidebar page. The bottom-right dock (PacklogJobsDock)
 * shows every job's progress; pages subscribe to `useFinishedCount` to
 * refresh their packlog list when one completes.
 */
import { useSyncExternalStore } from "react";
import toast from "react-hot-toast";
import { PacklogService, adaptPacklogDetail } from "../api/packlog-service";
import {
  announcePacklogResult,
  createPacklogFromFiles,
  type CreatePacklogInput,
  type CreateProgress,
} from "../utils/scan-and-pack/create-packlog";
import { downloadPdf } from "../utils/scan-and-pack/pdf-output";
import { fetchOrderBytes } from "../utils/scan-and-pack/print-dispatch";
import { orderComparator, readSort, sortLabel } from "../utils/scan-and-pack/sort";

export type PacklogJobStatus = "running" | "done" | "error";

export interface PacklogJob {
  id: string;
  kind: "create" | "download" | "print";
  title: string;
  subtitle: string;
  status: PacklogJobStatus;
  progress: CreateProgress;
  /** Outcome line once finished. */
  message?: string;
  /** The packlog the job made or read, for "Open". */
  packlogObjectId?: string | null;
  /** Print: the operator pressed Stop; the job ends after the label in flight. */
  stopRequested?: boolean;
}

let jobs: PacklogJob[] = [];
let finished = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const update = (id: string, patch: Partial<PacklogJob>) => {
  jobs = jobs.map((job) => (job.id === id ? { ...job, ...patch } : job));
  emit();
};

const add = (job: Omit<PacklogJob, "id" | "status" | "progress">): string => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  jobs = [...jobs, { ...job, id, status: "running", progress: { text: "Starting…" } }];
  emit();
  return id;
};

const finish = (id: string, patch: Partial<PacklogJob>) => {
  finished++;
  update(id, patch);
};

export const usePacklogJobs = () => useSyncExternalStore(subscribe, () => jobs);

/** Goes up by one each time a job ends — a dependency for list refreshes. */
export const useFinishedCount = () => useSyncExternalStore(subscribe, () => finished);

export const dismissPacklogJob = (id: string) => {
  jobs = jobs.filter((job) => job.id !== id || job.status === "running");
  emit();
};

/** Stop a running print after the label already sent. */
export const stopPacklogJob = (id: string) => update(id, { stopRequested: true, progress: { text: "Stopping…" } });

const stopRequested = (id: string) => Boolean(jobs.find((job) => job.id === id)?.stopRequested);

export const dismissFinishedJobs = () => {
  jobs = jobs.filter((job) => job.status === "running");
  emit();
};

/** Create a packlog in the background; the caller can move on straight away. */
export const startCreatePacklogJob = (input: Omit<CreatePacklogInput, "onProgress">) => {
  const id = add({
    kind: "create",
    title: `Creating packlog — ${input.sheetFile.name}`,
    subtitle: `${input.pdfFiles.length} PDF(s) · sorted by ${sortLabel(input.sortKey)}`,
  });
  void (async () => {
    try {
      const result = await createPacklogFromFiles({ ...input, onProgress: (progress) => update(id, { progress }) });
      announcePacklogResult(result);
      finish(id, {
        status: result.serverError ? "error" : "done",
        title: `Packlog ${result.batch.batchId}`,
        message: result.serverError
          ? `Not saved: ${result.serverError}`
          : `${result.newlyMapped} of ${result.batch.orders.length} orders mapped`,
        packlogObjectId: result.packlogObjectId,
        progress: { text: "", done: 1, total: 1 },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not process the upload.";
      toast.error(message);
      finish(id, { status: "error", message });
    }
  })();
};

/**
 * One PDF of a packlog's labels in its sort order (invoices instead for an
 * invoice-only packlog), built in the background.
 */
export const startSortedLabelsDownload = (packlogObjectId: string, packlogId: string) => {
  const running = jobs.find(
    (job) => job.kind === "download" && job.packlogObjectId === packlogObjectId && job.status === "running"
  );
  if (running) {
    toast(`The sorted labels of ${packlogId} are already being prepared.`);
    return;
  }
  const id = add({ kind: "download", title: `Sorted labels — ${packlogId}`, subtitle: "Preparing…", packlogObjectId });
  void (async () => {
    try {
      const response = await PacklogService.getPacklog(packlogObjectId);
      const envelope = (response as unknown as { data?: { data?: { packlog: unknown; orders: unknown[] } } })?.data
        ?.data;
      if (!envelope?.packlog) throw new Error("This packlog no longer exists.");
      const batch = adaptPacklogDetail(envelope as Parameters<typeof adaptPacklogDetail>[0]);
      const sortKey = readSort(batch);
      const part = batch.scanMode === "invoice" ? "invoice" : "label";
      const queue = batch.orders
        .filter((order) => (part === "label" ? order.mapping?.labelPages.length : order.mapping?.invoicePages.length))
        .sort(orderComparator(batch, sortKey));
      if (!queue.length) throw new Error(`No order of ${packlogId} has a ${part} mapped.`);
      update(id, { subtitle: `${queue.length} ${part}(s) · sorted by ${sortLabel(sortKey)}` });

      const { PDFDocument } = await import("pdf-lib");
      const out = await PDFDocument.create();
      for (const [index, order] of queue.entries()) {
        const source = await PDFDocument.load(await fetchOrderBytes(batch.id, order, part));
        const pages = await out.copyPages(source, source.getPageIndices());
        pages.forEach((page) => out.addPage(page));
        update(id, {
          progress: { text: "Adding labels…", done: index + 1, total: queue.length, unit: part === "label" ? "labels" : "invoices" },
        });
      }
      update(id, { progress: { text: "Saving the PDF…" } });
      const suffix = sortKey === "sheet" ? "" : `-by-${sortKey}`;
      downloadPdf(await out.save(), `${packlogId}-${part}s${suffix}.pdf`);
      toast.success(`Downloaded ${queue.length} sorted ${part}(s) of ${packlogId}.`);
      finish(id, {
        status: "done",
        message: `${queue.length} ${part}(s) downloaded`,
        progress: { text: "", done: queue.length, total: queue.length },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not build the PDF.";
      toast.error(message);
      finish(id, { status: "error", message });
    }
  })();
};

/**
 * Print a packlog's labels one by one, in its sort order (invoices instead for
 * an invoice-only packlog), on one printer. Each label waits until the printer
 * queue accepted the one before; a printed order is marked Packed, as a scan
 * would. Stops at the first refusal so nothing is skipped silently.
 */
export const startSortedLabelsPrint = (
  packlogObjectId: string,
  packlogId: string,
  printer: string,
  options: { skipPacked: boolean }
) => {
  const running = jobs.find(
    (job) => job.kind === "print" && job.packlogObjectId === packlogObjectId && job.status === "running"
  );
  if (running) {
    toast(`${packlogId} is already printing.`);
    return;
  }
  const id = add({ kind: "print", title: `Printing sorted labels — ${packlogId}`, subtitle: printer, packlogObjectId });
  void (async () => {
    let printed = 0;
    try {
      const response = await PacklogService.getPacklog(packlogObjectId);
      const envelope = (response as unknown as { data?: { data?: { packlog: unknown; orders: unknown[] } } })?.data
        ?.data;
      if (!envelope?.packlog) throw new Error("This packlog no longer exists.");
      const batch = adaptPacklogDetail(envelope as Parameters<typeof adaptPacklogDetail>[0]);
      const sortKey = readSort(batch);
      const part = batch.scanMode === "invoice" ? "invoice" : "label";
      const queue = batch.orders
        .filter((order) => (part === "label" ? order.mapping?.labelPages.length : order.mapping?.invoicePages.length))
        .filter((order) => !options.skipPacked || order.packStatus !== "packed")
        .sort(orderComparator(batch, sortKey));
      if (!queue.length) {
        throw new Error(
          options.skipPacked ? `Every ${part} of ${packlogId} is already packed.` : `No order of ${packlogId} has a ${part} mapped.`
        );
      }
      update(id, { subtitle: `${printer} · ${queue.length} ${part}(s) · sorted by ${sortLabel(sortKey)}` });

      for (const [index, order] of queue.entries()) {
        if (stopRequested(id)) break;
        const awb = order.awbRaw || order.awb || order.id;
        update(id, {
          progress: { text: `Printing ${awb}…`, done: index, total: queue.length, unit: part === "label" ? "labels" : "invoices" },
        });
        const result = await window.printAgent.scanPack.printPart(batch.id, order.id, [part], printer, `${awb} ${part}`);
        if (!result.ok) throw new Error(`Stopped at ${awb} (${index + 1} of ${queue.length}): ${result.error}`);
        printed++;
        // The printer took it, so the parcel is packed — the same rule as a scan.
        await PacklogService.markPacked(batch.id, order.id).catch((err: unknown) =>
          console.warn(`[scan-and-pack] printed ${awb} but could not mark it packed:`, err)
        );
      }

      const stopped = stopRequested(id) && printed < queue.length;
      const message = stopped
        ? `Stopped — ${printed} of ${queue.length} ${part}(s) printed`
        : `${printed} ${part}(s) sent to ${printer}`;
      if (stopped) toast(message);
      else toast.success(`${packlogId}: ${message}.`);
      finish(id, { status: "done", message, progress: { text: "", done: printed, total: queue.length } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not print.";
      toast.error(message);
      finish(id, { status: "error", message: printed ? `${printed} printed. ${message}` : message });
    }
  })();
};
