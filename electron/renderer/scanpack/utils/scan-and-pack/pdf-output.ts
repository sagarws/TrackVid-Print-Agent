/**
 * Building printable / downloadable PDFs for a single order.
 *
 * Only page indices are stored against an order, so the label and invoice are
 * extracted from the original upload on demand with pdf-lib. That keeps
 * IndexedDB holding one copy of each source PDF instead of one slice per row.
 */
import { ParseSpeeds, PDFDocument } from "pdf-lib";
import type { ScanPackOrder } from "../../types/scanAndPack.types";
import { getDocument } from "./db";
import { elapsed, now } from "./perf";

/** Per-step timings of one buildOrderPdf call, for the upload's time log. */
export interface BuildTiming {
  readSourceMs: number;
  loadSourceMs: number;
  copyAndSaveMs: number;
  sourceKb: number;
  /** The source was already parsed for an earlier order of this upload. */
  reused: boolean;
}

export type PrintPart = "label" | "invoice" | "both";

const pagesFor = (order: ScanPackOrder, part: PrintPart): number[] => {
  if (!order.mapping) return [];
  const { labelPages, invoicePages } = order.mapping;
  if (part === "label") return labelPages;
  if (part === "invoice") return invoicePages;
  return [...labelPages, ...invoicePages];
};

/**
 * AGENT CHANGE: the parsed source PDF, kept for the next call.
 *
 * An upload cuts every order's label and invoice out of the same source file,
 * and each call used to read it back from IndexedDB and parse the whole thing
 * again — two full parses per order, ~40% of an upload even in the foreground.
 * Only the most recent source is kept, so a 100 MB file is held once, not per
 * order, and never after the next document is opened.
 */
let cachedSource: { docId: string; doc: Promise<PDFDocument>; sourceKb: number } | null = null;

const loadSource = async (
  docId: string
): Promise<{ doc: PDFDocument; readSourceMs: number; loadSourceMs: number; sourceKb: number; reused: boolean }> => {
  if (cachedSource?.docId === docId) {
    return { doc: await cachedSource.doc, readSourceMs: 0, loadSourceMs: 0, sourceKb: cachedSource.sourceKb, reused: true };
  }
  let start = now();
  const stored = await getDocument(docId);
  const readSourceMs = elapsed(start);
  if (!stored) throw new Error("The source PDF for this order is no longer available.");

  start = now();
  // ParseSpeeds.Fastest: parse in one go. The default yields to the event loop
  // every 100 objects via setTimeout, and every one of those yields stalled
  // whenever the window was in the background.
  const doc = PDFDocument.load(stored.bytes, { parseSpeed: ParseSpeeds.Fastest });
  const sourceKb = Math.round(stored.bytes.byteLength / 1024);
  cachedSource = { docId, doc, sourceKb };
  try {
    const loaded = await doc;
    return { doc: loaded, readSourceMs, loadSourceMs: elapsed(start), sourceKb, reused: false };
  } catch (err) {
    cachedSource = null;
    throw err;
  }
};

export const buildOrderPdf = async (
  order: ScanPackOrder,
  part: PrintPart,
  onTiming?: (timing: BuildTiming) => void
): Promise<Uint8Array> => {
  if (!order.mapping) throw new Error("This order has no label or invoice mapped yet.");

  const pageIndices = pagesFor(order, part);
  if (!pageIndices.length) {
    throw new Error(part === "invoice" ? "No invoice page was found for this AWB." : "No label page was found for this AWB.");
  }

  const { doc: source, readSourceMs, loadSourceMs, sourceKb, reused } = await loadSource(order.mapping.docId);
  const start = now();
  const out = await PDFDocument.create();
  // Guard against a stored mapping that points past the end of the PDF (e.g.
  // the same batch re-scanned against a shorter file).
  const valid = pageIndices.filter((index) => index >= 0 && index < source.getPageCount());
  if (!valid.length) throw new Error("The mapped pages are missing from the source PDF.");

  const copied = await out.copyPages(source, valid);
  copied.forEach((page) => out.addPage(page));
  const saved = await out.save();
  onTiming?.({
    readSourceMs,
    loadSourceMs,
    copyAndSaveMs: elapsed(start),
    sourceKb,
    reused,
  });
  return saved;
};

const toBlob = (bytes: Uint8Array) =>
  // Copy into a plain ArrayBuffer — pdf-lib can hand back a view over a larger
  // buffer, and Blob would otherwise embed the whole thing.
  new Blob([bytes.slice().buffer], { type: "application/pdf" });

export const downloadPdf = (bytes: Uint8Array, fileName: string) => {
  const url = URL.createObjectURL(toBlob(bytes));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // The download is already queued by the time click() returns; revoking on the
  // next tick releases the blob without cancelling it.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** How long the hidden print frame is kept alive after the dialog is opened. */
const PRINT_FRAME_TTL_MS = 60_000;

export const printPdf = async (bytes: Uint8Array) => {
  const url = URL.createObjectURL(toBlob(bytes));
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
    visibility: "hidden",
  });

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    frame.remove();
    URL.revokeObjectURL(url);
  };

  document.body.appendChild(frame);

  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error("The PDF could not be prepared for printing."));
      frame.src = url;
    });
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    // The print dialog reads the document asynchronously, so the frame and its
    // blob URL cannot be torn down immediately.
    window.setTimeout(cleanup, PRINT_FRAME_TTL_MS);
  } catch {
    // Some browsers refuse to print a PDF inside a hidden frame; fall back to
    // the built-in viewer in a new tab and let the operator print from there.
    cleanup();
    const viewerUrl = URL.createObjectURL(toBlob(bytes));
    const opened = window.open(viewerUrl, "_blank");
    if (!opened) {
      URL.revokeObjectURL(viewerUrl);
      throw new Error("Allow pop-ups for this site to print the label.");
    }
    window.setTimeout(() => URL.revokeObjectURL(viewerUrl), PRINT_FRAME_TTL_MS);
  }
};
