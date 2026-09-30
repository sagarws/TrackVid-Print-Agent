/**
 * Scan & Pack — the one place that turns an order into paper.
 *
 * Extracted from the pack page because Reprint on the packlog table needs the
 * exact same behaviour: same printer assignment, same "both" splitting, same
 * agent-then-browser fallback. Two copies of this logic would drift the first
 * time someone changed a printer rule on one screen only.
 */
import { PacklogService } from "../../api/packlog-service";
import type { PrintPart } from "./pdf-output";
import {
  LOCALSTORAGE_SCANPACK_INVOICE_PRINTER,
  LOCALSTORAGE_SCANPACK_LABEL_PRINTER,
  LOCALSTORAGE_SCANPACK_OUTPUT_MODE,
  LOCALSTORAGE_SCANPACK_PRINT_TARGET,
} from "../../config/constant";
import type { ScanMode, ScanPackBatch, ScanPackOrder } from "../../types/scanAndPack.types";

/**
 * The Print target toggle is sticky across sessions — an operator who packs
 * "Both" all day shouldn't have to re-pick it every time they open a packlog.
 * Falls back to "both" for a fresh install.
 */
export const readStoredTarget = (): PrintPart => {
  const raw = localStorage.getItem(LOCALSTORAGE_SCANPACK_PRINT_TARGET);
  return raw === "label" || raw === "invoice" || raw === "both" ? raw : "both";
};

/** AGENT: print on the assigned printers, or save the PDF to Downloads (Auto Download). */
export type OutputMode = "print" | "download";

export const readOutputMode = (): OutputMode =>
  localStorage.getItem(LOCALSTORAGE_SCANPACK_OUTPUT_MODE) === "download" ? "download" : "print";

export const readLabelPrinter = () =>
  localStorage.getItem(LOCALSTORAGE_SCANPACK_LABEL_PRINTER) ?? "";
export const readInvoicePrinter = () =>
  localStorage.getItem(LOCALSTORAGE_SCANPACK_INVOICE_PRINTER) ?? "";

export interface PrintTargetMismatch {
  scanMode: ScanMode;
  printTarget: PrintPart;
}

/**
 * The operator's Print Target must equal the packlog's scan mode (the Scan
 * Target picked when the packlog was uploaded, stored on the packlog). Any
 * difference — label vs both, both vs invoice, … — blocks the print and the
 * operator is asked to change Printer Setup, rather than the page quietly
 * printing something other than what was set.
 *
 * Returns null when they match. A packlog saved before scanMode existed reads
 * as "both", the server default.
 */
export const findPrintTargetMismatch = (
  printTarget: PrintPart,
  scanMode: ScanPackBatch["scanMode"]
): PrintTargetMismatch | null => {
  const mode: ScanMode = scanMode ?? "both";
  return printTarget === mode ? null : { scanMode: mode, printTarget };
};

/**
 * Fetch the PDF bytes for one part of one order from S3 (via the BE). For
 * `label` / `invoice` this is a single download; for `both` we grab each side
 * separately and concatenate with pdf-lib so a single print/download still
 * produces one file.
 */
export const fetchOrderBytes = async (
  packlogObjectId: string,
  order: ScanPackOrder,
  part: PrintPart
): Promise<Uint8Array> => {
  const one = async (p: "label" | "invoice") => {
    const buffer = await PacklogService.downloadPart(packlogObjectId, order.id, p);
    return new Uint8Array(buffer);
  };
  if (part !== "both") return one(part);

  const { PDFDocument } = await import("pdf-lib");
  const [labelBytes, invoiceBytes] = await Promise.all([one("label"), one("invoice")]);
  const out = await PDFDocument.create();
  for (const bytes of [labelBytes, invoiceBytes]) {
    const source = await PDFDocument.load(bytes);
    const copied = await out.copyPages(source, source.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  return out.save();
};

/**
 * What actually happened, so the caller can word its own toast — and, more
 * importantly, decide whether the parcel may be marked Packed.
 */
export interface PrintOutcome {
  /**
   * True when the TrackVid Print Agent accepted the job and handed it to the
   * OS print queue.
   *
   * This is the strongest signal available in a browser, and callers treat it
   * as "printed". Know what it does and does not cover:
   *   IT CATCHES  agent not running, this site not on its allowed list,
   *               unknown printer name, the OS refusing the job, a
   *               malformed PDF.
   *   IT MISSES   out of paper, a jam, a powered-off printer, someone
   *               cancelling at the OS spooler. The job is queued; the paper
   *               may never appear.
   *
   * False means the browser print dialog was opened instead, which reports
   * nothing back at all — not even whether the operator pressed Cancel. A
   * caller must NOT record a parcel as packed on a false.
   */
  viaAgent: boolean;
  message: string;
}

/**
 * Send one order to the configured printer(s).
 *
 * When target is `both` and the two printers differ, the label and the invoice
 * are fetched and dispatched separately so each lands on its own device.
 * Everything else goes out as a single job. If the print agent is unreachable or
 * rejects the job we fall back to the browser print dialog rather than
 * silently dropping the parcel.
 */
/**
 * AGENT CHANGE: print through the agent by reference. The main process sends
 * the packlog's source PDF with a page range (or an order's own PDF, for
 * packlogs saved before sources) — no PDF is fetched into this window or cut.
 */
const printByRef = async (
  packlogObjectId: string,
  orderId: string,
  parts: ("label" | "invoice")[],
  printer: string,
  jobName: string
) => {
  const result = await window.printAgent.scanPack.printPart(packlogObjectId, orderId, parts, printer, jobName);
  if (!result.ok) throw new Error(result.error);
};

export const dispatchPrint = async (
  packlogObjectId: string,
  order: ScanPackOrder,
  part: PrintPart
): Promise<PrintOutcome> => {
  const labelPrinter = readLabelPrinter();
  const invoicePrinter = readInvoicePrinter();
  // Shown in the agent's job list and the OS print queue.
  const awb = order.awbRaw || order.awb || order.id;

  // AGENT: Auto Download. The order's PDF (label / invoice / both, per the
  // target) is saved to Downloads by the main process, which answers only
  // once the file is on disk — so, like a confirmed print, it packs the order.
  if (readOutputMode() === "download") {
    const bytes = await fetchOrderBytes(packlogObjectId, order, part);
    const result = await window.printAgent.scanPack.saveDownload(bytes, `${awb}-${part}.pdf`);
    if (!result.ok) throw new Error(`Could not save the PDF: ${result.error}`);
    return { viaAgent: true, message: `Downloaded ${awb} ${part} → ${result.value}` };
  }

  // Label and invoice on separate printers: two jobs. A refusal on either
  // throws with the printer's reason, and the parcel is not packed.
  if (part === "both" && labelPrinter && invoicePrinter && labelPrinter !== invoicePrinter) {
    await printByRef(packlogObjectId, order.id, ["label"], labelPrinter, `${awb} label`);
    try {
      await printByRef(packlogObjectId, order.id, ["invoice"], invoicePrinter, `${awb} invoice`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Label sent → ${labelPrinter}, but the invoice was not: ${reason}`, { cause: err });
    }
    return { viaAgent: true, message: `Sent label → ${labelPrinter}, invoice → ${invoicePrinter}.` };
  }

  const printerForPart = part === "invoice" ? invoicePrinter || labelPrinter : labelPrinter;
  if (printerForPart) {
    const parts: ("label" | "invoice")[] = part === "both" ? ["label", "invoice"] : [part];
    await printByRef(packlogObjectId, order.id, parts, printerForPart, `${awb} ${part}`);
    return {
      viaAgent: true,
      message: `Sent ${part === "both" ? "label + invoice" : part} → ${printerForPart}.`,
    };
  }

  // AGENT CHANGE: no printer assigned. The web app opens the browser's print
  // dialog here; the agent's window has no PDF viewer to print from, and the
  // agent's own printers are one click away in Printer Setup.
  throw new Error(
    part === "invoice"
      ? "No invoice or label printer is assigned. Open Printer Setup and pick one."
      : "No label printer is assigned. Open Printer Setup and pick one."
  );
};
