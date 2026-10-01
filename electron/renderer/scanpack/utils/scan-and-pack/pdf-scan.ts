/**
 * Label/invoice PDF scanning.
 *
 * A shipping-label PDF is a run of `label page -> invoice page(s)` blocks. We
 * classify every page from its text layer (cheap), pull the AWB from the text
 * when the marketplace prints one, and fall back to rasterising the page and
 * decoding its Code128 barcode when it does not.
 *
 * Amazon needs that fallback: its label page is a single 1-bit image, so the
 * only machine-readable copy of the AWB on the page is the barcode itself.
 */
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import PdfJsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import zxingWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import type { ScanMode, ScanReport, ScannedLabel } from "../../types/scanAndPack.types";
import { getPlatform, normaliseAwb, type PlatformConfig } from "./platforms";
import { elapsed, now, perfLog, recordLabel, type StageTotals } from "./perf";

/**
 * pdf.js is handed a Worker instance rather than a `workerSrc` URL.
 *
 * Pointing `workerSrc` at an `?url` asset makes pdf.js construct the worker
 * itself; when that construction fails it silently falls back to dynamically
 * importing the same path, which the dev server cannot serve as a module
 * ("Setting up fake worker failed: Failed to fetch dynamically imported
 * module ... pdf.worker.min.mjs?import"). Vite's `?worker` import bundles the
 * worker properly for both dev and build, so there is no URL to resolve and no
 * fake-worker fallback to hit.
 */
const createWorker = () => pdfjsLib.PDFWorker.fromPort({ port: new PdfJsWorker() });

/**
 * Rasterisation scales tried, in order. 2x matches the native resolution of an
 * Amazon label (a ~1216x1824 image on an A4 page); 3x is the retry for labels
 * printed smaller, where the Code128 bars alias away at 2x.
 */
const RENDER_SCALES = [2, 3];

/**
 * Largest PDF this will read, per file.
 *
 * Exported so the drop zone can refuse it at selection time rather than after
 * the operator has waited for a scan to start — same number, stated once.
 */
export const MAX_PDF_MB = 100;
export const MAX_PDF_BYTES = MAX_PDF_MB * 1024 * 1024;

/** "12.4MB" — for a message an operator reads, not a log line. */
export const formatMb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

let zxingReady: Promise<unknown> | null = null;

/** The wasm binary is fetched once per session and reused for every scan. */
const ensureZXing = () => {
  if (!zxingReady) {
    zxingReady = prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? zxingWasmUrl : prefix + path) },
      fireImmediately: true,
    });
  }
  return zxingReady;
};

const getPageText = async (page: PDFPageProxy) => {
  const content = await page.getTextContent();
  return content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ")
    .replace(/\s+/g, " ");
};

/**
 * Render one page to a canvas and hand the pixels to ZXing.
 * The canvas is passed in so a single backing store is reused across the whole
 * document instead of allocating one bitmap per page.
 */
const decodeAwbFromPage = async (
  page: PDFPageProxy,
  platform: PlatformConfig,
  canvas: HTMLCanvasElement,
  timing?: { label: string; totals?: StageTotals }
): Promise<string | null> => {
  let start = now();
  await ensureZXing();
  const wasmMs = elapsed(start);
  if (timing && wasmMs > 5) perfLog(`${timing.label} ${wasmMs} ms taken in scan: load barcode reader (wasm)`);

  for (const scale of RENDER_SCALES) {
    try {
      const viewport = page.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;

      // Labels are 1-bit black-on-transparent; without an opaque white ground
      // the binarizer sees the bars against black and finds nothing.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      start = now();
      await page.render({ canvasContext: context, viewport }).promise;
      const renderMs = elapsed(start);

      start = now();
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const results = await readBarcodes(imageData, {
        formats: platform.barcodeFormats as never,
        tryHarder: true,
        maxNumberOfSymbols: 8,
      });
      const decodeMs = elapsed(start);
      if (timing) {
        const found = results.some((r) => platform.awbFromBarcode(r.text ?? ""));
        perfLog(`${timing.label} ${renderMs} ms taken in scan: render page as image at ${scale}x (${canvas.width}×${canvas.height} px)`);
        perfLog(`${timing.label} ${decodeMs} ms taken in scan: decode barcode at ${scale}x (${found ? "found" : "not found"})`);
        timing.totals?.add("scan: render page image (barcode fallback)", renderMs);
        timing.totals?.add("scan: decode barcode", decodeMs);
      }

      // AGENT CHANGE: collect every acceptable barcode, then let the platform
      // pick (Flipkart: the `FM…` id over the courier's AWB) — not just the first.
      const candidates = results
        .map((result) => platform.awbFromBarcode(result.text ?? ""))
        .filter((value): value is string => Boolean(value));
      if (candidates.length) {
        return normaliseAwb(platform.preferAwb ? platform.preferAwb(candidates) : candidates[0]);
      }
    } catch (error) {
      // One page that will not rasterise (missing font data, corrupt XObject)
      // must not abort the whole batch — it is reported as unreadable instead.
      console.warn("[scan-and-pack] page render failed", error);
    }
  }
  return null;
};

export interface ScanProgress {
  page: number;
  totalPages: number;
  fileName: string;
}

/**
 * Scan a single label/invoice PDF into `{ awb -> label pages + invoice pages }`.
 *
 * Invoice pages are assigned by position: everything between one label page and
 * the next belongs to that label. That keeps multi-page invoices intact instead
 * of assuming a fixed 1-label/1-invoice stride.
 */
export const scanLabelPdf = async (
  file: File,
  platformKey: string,
  docId: string,
  onProgress?: (progress: ScanProgress) => void,
  options: { scanMode?: ScanMode; totals?: StageTotals } = {}
): Promise<{ report: ScanReport; bytes: ArrayBuffer }> => {
  const platform = getPlatform(platformKey);
  if (!platform || !platform.enabled) {
    throw new Error(`Scanning is not supported for platform "${platformKey}" yet.`);
  }

  const scanMode: ScanMode = options.scanMode ?? "both";
  const platformCanInvoice = Boolean(platform.isInvoicePage && platform.awbFromInvoiceText);
  if (scanMode === "invoice" && !platformCanInvoice) {
    throw new Error(`Invoice-only scanning is not supported for ${platform.label} yet.`);
  }

  // REFUSED BEFORE IT IS READ, because everything after this point holds the
  // whole file in memory at once — `arrayBuffer()` here, the bytes kept on the
  // ScannedDocument for the output step, and the copy IndexedDB keeps when the
  // session is saved. Three copies of whatever was dropped in.
  //
  // There was no limit at all, and the page that uses this is a packing desk:
  // the realistic accident is not an attack but a whole day's labels dragged in
  // as one file. Without a cap the tab allocates until it is killed, and the
  // operator loses the session they were part-way through with no message.
  //
  // 100MB is far above any real label run (a 1,000-page label PDF is single-
  // digit MB) and still well inside what a browser tab can hold three times.
  if (file.size > MAX_PDF_BYTES) {
    throw new Error(
      `"${file.name}" is ${formatMb(file.size)} — larger than the ${MAX_PDF_MB}MB limit. ` +
        "Split the file and scan it in parts.",
    );
  }

  let start = now();
  const bytes = await file.arrayBuffer();
  const readMs = elapsed(start);
  start = now();
  // Passing an explicit worker means pdf.js does not adopt it, so this function
  // owns the teardown — see the `finally` block below.
  const worker = createWorker();
  // pdf.js transfers/detaches the buffer it is given, so it gets its own copy
  // and the pristine `bytes` stay usable for storage and page extraction.
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)), worker });
  const doc: PDFDocumentProxy = await loadingTask.promise;
  const loadMs = elapsed(start);
  perfLog(`${file.name}: ${readMs} ms taken in read file (${Math.round(file.size / 1024)} KB), ${loadMs} ms taken in open PDF (${doc.numPages} pages)`);
  options.totals?.add("scan: read + open PDF", readMs + loadMs);

  const canvas = document.createElement("canvas");
  // AGENT CHANGE — the anchor is the platform's, whatever the scan mode.
  //
  // The anchor is WHERE THE AWB IS READ: the page that reliably carries it
  // (AJIO: the invoice text; Amazon / Myntra / Flipkart: the label). The scan
  // mode only decides which pages each order keeps (trimmed below).
  //
  // It used to follow the mode — "invoice" forced invoice-anchored, "label"
  // forced label-anchored — so Amazon in Invoice mode found 0 orders when its
  // invoices did not name the AWB, and AJIO in Label mode fell back to the
  // label barcode that cropping cuts off. Now Amazon's invoices are the pages
  // after each label found by barcode, and AJIO's labels are the page before
  // each invoice found by its text.
  const useInvoiceAnchor = Boolean(platform.useInvoiceAsAnchor && platformCanInvoice);
  const pageInfos: {
    pageIndex: number;
    text: string;
    isLabel: boolean;
    isInvoice: boolean;
    awb: string | null;         // decoded label AWB (label-anchored path)
    invoiceAwb: string | null;  // extracted invoice AWB (invoice-anchored path)
  }[] = [];

  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      onProgress?.({ page: pageNo, totalPages: doc.numPages, fileName: file.name });
      const pageStart = now();
      start = now();
      const page = await doc.getPage(pageNo);
      const getPageMs = elapsed(start);
      try {
        start = now();
        const text = await getPageText(page);
        const textMs = elapsed(start);
        const pageLabel = recordLabel("page", pageNo);
        options.totals?.add("scan: open page", getPageMs);
        options.totals?.add("scan: extract text", textMs);
        let isLabel = false;
        let isInvoice = false;
        let awb: string | null = null;
        let invoiceAwb: string | null = null;
        if (useInvoiceAnchor) {
          isInvoice = platform.isInvoicePage!(text);
          if (isInvoice) invoiceAwb = platform.awbFromInvoiceText!(text);
        } else {
          isLabel = platform.isLabelPage(text);
          if (isLabel) {
            const fromText = platform.awbFromText(text);
            awb = fromText
              ? normaliseAwb(fromText)
              : await decodeAwbFromPage(page, platform, canvas, { label: pageLabel, totals: options.totals });
          }
        }
        pageInfos.push({ pageIndex: pageNo - 1, text, isLabel, isInvoice, awb, invoiceAwb });
        const kind = isLabel ? "label page" : isInvoice ? "invoice page" : "other page";
        const found = awb ?? invoiceAwb;
        const how = found ? "AWB found" : isLabel ? "no AWB found" : "no AWB needed";
        perfLog(`${recordLabel("page", pageNo, found)} ${elapsed(pageStart)} ms taken in scan (${kind}, ${how}; open ${getPageMs} ms, text ${textMs} ms)`);
      } finally {
        page.cleanup();
      }
    }
  } finally {
    // Drop the backing bitmap and the worker before returning — a 100-page
    // scan otherwise holds on to both for the life of the tab.
    canvas.width = 0;
    canvas.height = 0;
    await loadingTask.destroy();
    // Read the port before destroy() clears it.
    const port = worker.port;
    worker.destroy();
    // `PDFWorker.destroy()` only terminates workers pdf.js created itself, so
    // the thread behind our injected port has to be shut down explicitly.
    port?.terminate();
  }

  const unreadablePages: number[] = [];
  const seen = new Set<string>();
  const duplicateAwbs: string[] = [];
  let labels: ScannedLabel[] = [];

  if (useInvoiceAnchor) {
    // Invoice-anchored: walk the page list, group consecutive invoice pages,
    // extract the AWB from the invoice text, and take the page immediately
    // before each group as its label. No positional "next-label" arithmetic
    // that could drift if a label was mis-classified.
    const claimed = new Set<number>();
    let i = 0;
    while (i < pageInfos.length) {
      if (!pageInfos[i]!.isInvoice) { i++; continue; }
      const groupStart = i;
      const invoicePages: number[] = [];
      let awb: string | null = null;
      while (i < pageInfos.length && pageInfos[i]!.isInvoice) {
        invoicePages.push(pageInfos[i]!.pageIndex);
        if (!awb && pageInfos[i]!.invoiceAwb) awb = normaliseAwb(pageInfos[i]!.invoiceAwb!);
        i++;
      }
      if (!awb) {
        unreadablePages.push(groupStart + 1);
        continue;
      }
      // Index reads below stay inside their own bounds checks; `!` is for
      // noUncheckedIndexedAccess, which TrackVid-FE does not enable.
      const labelIdx = groupStart - 1;
      const labelPages: number[] = [];
      if (labelIdx >= 0 && !pageInfos[labelIdx]!.isInvoice && !claimed.has(labelIdx)) {
        labelPages.push(labelIdx);
        claimed.add(labelIdx);
      }
      invoicePages.forEach((p) => claimed.add(p));
      // A missing preceding-label is only fatal when the operator wanted BOTH
      // sides. In "invoice" mode we drop labelPages anyway (see the trim
      // below), so an invoice that stands alone at the top of the PDF still
      // yields a packable AWB.
      if (!labelPages.length && scanMode !== "invoice") {
        unreadablePages.push(groupStart + 1);
        continue;
      }
      if (seen.has(awb)) duplicateAwbs.push(awb);
      seen.add(awb);
      labels.push({ awb, labelPages, invoicePages });
    }
    // Non-invoice pages never claimed as a label are orphan labels (no invoice
    // to name them). Report them so Bulk Update can catch anything the operator
    // needs to intervene on.
    for (const info of pageInfos) {
      if (!info.isInvoice && !claimed.has(info.pageIndex)) {
        unreadablePages.push(info.pageIndex + 1);
      }
    }
    unreadablePages.sort((a, b) => a - b);
  } else {
    // Label-anchored (default). Second pass: labels whose barcode did not
    // decode try to steal their AWB from the invoice text that follows them.
    // Bounded by the next label page so one broken label can never inherit the
    // AWB of a downstream shipment.
    const recoverFromInvoice = platform.awbFromInvoiceText;
    if (recoverFromInvoice) {
      for (let i = 0; i < pageInfos.length; i++) {
        const info = pageInfos[i]!;
        if (!info.isLabel || info.awb) continue;
        for (let j = i + 1; j < pageInfos.length && !pageInfos[j]!.isLabel; j++) {
          const recovered = recoverFromInvoice(pageInfos[j]!.text);
          if (recovered) {
            info.awb = normaliseAwb(recovered);
            break;
          }
        }
      }
    }

    const labelPageHits: { pageIndex: number; awb: string }[] = [];
    for (const info of pageInfos) {
      if (!info.isLabel) continue;
      if (info.awb) labelPageHits.push({ pageIndex: info.pageIndex, awb: info.awb });
      else unreadablePages.push(info.pageIndex + 1);
    }

    labels = labelPageHits.map((hit, index) => {
      const nextLabelPage = labelPageHits[index + 1]?.pageIndex ?? doc.numPages;
      const invoicePages: number[] = [];
      for (let p = hit.pageIndex + 1; p < nextLabelPage; p++) invoicePages.push(p);

      if (seen.has(hit.awb)) duplicateAwbs.push(hit.awb);
      seen.add(hit.awb);

      return { awb: hit.awb, labelPages: [hit.pageIndex], invoicePages };
    });
  }

  // Enforce scanMode: label-only drops any invoice pages the anchor pass
  // collected, invoice-only drops the label pages. Neither can create new
  // pages that were not on the source PDF.
  if (scanMode === "label") {
    labels = labels.map((l) => ({ ...l, invoicePages: [] }));
  } else if (scanMode === "invoice") {
    labels = labels.map((l) => ({ ...l, labelPages: [] }));
  }
  // An AWB found on its anchor page but without the part that was asked for
  // (Invoice mode, and no invoice page follows the label) has nothing to
  // print: leave the order unmapped rather than mapped to no pages.
  const withoutPart = labels.filter((l) => !l.labelPages.length && !l.invoicePages.length);
  if (withoutPart.length) {
    console.info(
      `[scan-and-pack] ${withoutPart.length} AWB(s) found on the ${useInvoiceAnchor ? "invoice" : "label"} ` +
        `but with no ${scanMode} page: ${withoutPart.map((l) => l.awb).join(", ")}`
    );
    labels = labels.filter((l) => l.labelPages.length || l.invoicePages.length);
  }

  // Breadcrumb for the packing-desk console — makes "no mapping happened"
  // reports diagnosable without re-running with a debugger. Cheap: one log
  // per uploaded PDF.
  console.info(
    `[scan-and-pack] ${file.name} · platform=${platformKey} · mode=${scanMode} · ` +
      `anchor=${useInvoiceAnchor ? "invoice" : "label"} · pages=${doc.numPages} · ` +
      `labels=${labels.length} · unreadable=${unreadablePages.length}`,
  );

  return {
    report: {
      docId,
      fileName: file.name,
      totalPages: doc.numPages,
      labels,
      unreadablePages,
      duplicateAwbs: [...new Set(duplicateAwbs)],
    },
    bytes,
  };
};

export interface ScannedDocument {
  report: ScanReport;
  bytes: ArrayBuffer;
  fileName: string;
}

/**
 * Scan every uploaded PDF in turn. Sequential on purpose — each page render
 * allocates a full-page bitmap, and running several documents at once on a
 * packing-desk machine is what makes the tab run out of memory.
 */
export const scanLabelPdfs = async (
  files: File[],
  platformKey: string,
  makeDocId: (file: File, index: number) => string,
  onProgress?: (progress: ScanProgress & { fileIndex: number; totalFiles: number }) => void,
  options: { scanMode?: ScanMode; totals?: StageTotals } = {}
): Promise<ScannedDocument[]> => {
  const scanned: ScannedDocument[] = [];
  for (const [index, file] of files.entries()) {
    const docId = makeDocId(file, index);
    const { report, bytes } = await scanLabelPdf(
      file,
      platformKey,
      docId,
      (progress) => onProgress?.({ ...progress, fileIndex: index, totalFiles: files.length }),
      options,
    );
    scanned.push({ report, bytes, fileName: file.name });
  }
  return scanned;
};
