/**
 * Create a packlog from an order list and its label/invoice PDFs: read the
 * sheet, scan the PDFs, match AWBs, then save the packlog, each source PDF
 * once, and every order's pages.
 *
 * Has no UI of its own — progress goes to `onProgress` and the outcome comes
 * back — so the Upload Packlog modal and the Label Sorting background runner
 * share it.
 */
import toast from "react-hot-toast";
import type { PacklogSortKey } from "@shared/types/scanpack";
import { PacklogService } from "../../api/packlog-service";
import type { ScanMode, ScanPackBatch, ScanPackDocument } from "../../types/scanAndPack.types";
import { applyScanReports, buildOrders, generateBatchId } from "./batch";
import { saveBatch, saveDocuments } from "./db";
import { scanLabelPdfs } from "./pdf-scan";
import { elapsed, now as perfNow, perfLog, recordLabel, StageTotals } from "./perf";
import { parseOrderSheet } from "./sheet";

export interface CreateProgress {
  text: string;
  done?: number;
  total?: number;
  /** What is being counted: "pages", "orders", "files". */
  unit?: string;
}

export interface CreatePacklogInput {
  sheetFile: File;
  pdfFiles: File[];
  platform: string;
  scanMode: ScanMode;
  /** Label Sorting: the sort saved with the packlog. */
  sortKey?: PacklogSortKey | null;
  onProgress?: (progress: CreateProgress) => void;
}

export interface CreatePacklogResult {
  batch: ScanPackBatch;
  /** The agent's id for the packlog (what the packlog pages navigate by); null when saving failed. */
  packlogObjectId: string | null;
  newlyMapped: number;
  stillUnmapped: number;
  /** Source PDFs that could not be saved. */
  saveFailed: { total: number; failed: number; firstError: string | null } | null;
  /** The packlog record itself could not be saved. */
  serverError: string | null;
  /** Record PDFs still being cut in the background. */
  backgroundLeft: number;
}

/**
 * Save a freshly-created batch: the packlog record, then each source PDF once
 * and every order's page numbers in one call. No PDF is cut per order —
 * printing sends the source with a page range, and the preview and Download
 * cut the one order they need, on demand.
 */
const persistPacklog = async (
  batch: ScanPackBatch,
  orders: ScanPackBatch["orders"],
  totals: StageTotals,
  sources: { id: string; name: string; bytes: ArrayBuffer; pageCount: number }[],
  sortKey: PacklogSortKey | null,
  setProgress: (progress: CreateProgress) => void
) => {
  const createStart = perfNow();
  const raw = await PacklogService.createPacklog({
    packlogId: batch.batchId,
    platform: batch.platform,
    scanMode: batch.scanMode ?? "both",
    orderFileName: batch.orderFileName,
    headers: batch.headers,
    ...(sortKey ? { sortKey } : {}),
    orders: orders.map((o) => ({
      rowIndex: o.rowIndex,
      awb: o.awb,
      awbRaw: o.awbRaw,
      rawRow: o.raw,
    })),
  });
  // Two-level unwrap: response → envelope → payload.
  const payload = (
    raw as unknown as {
      data?: { data?: { id?: string; orders?: { rowIndex: number; awb: string; id: string }[] } };
    }
  )?.data?.data;
  const createMs = elapsed(createStart);
  perfLog(`${createMs} ms taken in create packlog record (${orders.length} rows)`);
  totals.add("save: create packlog record", createMs);
  const packlogObjectId = String(payload?.id ?? "");
  const backendIdByAwb = new Map((payload?.orders ?? []).map((o) => [o.awb, o.id]));
  if (!packlogObjectId) {
    throw new Error("Server did not return a packlog id — packlog not saved to server.");
  }

  let failed = 0;
  let firstError: string | null = null;
  const total = sources.length;
  for (const [index, source] of sources.entries()) {
    setProgress({ text: "Saving label & invoice PDFs…", done: index, total, unit: "files" });
    const saveStart = perfNow();
    try {
      await PacklogService.saveSource(
        packlogObjectId,
        source.id,
        source.name,
        new Uint8Array(source.bytes),
        source.pageCount
      );
    } catch (err) {
      failed++;
      firstError ??= err instanceof Error ? err.message : String(err);
      console.warn(`[scan-and-pack] failed to save ${source.name}:`, err);
    }
    const saveMs = elapsed(saveStart);
    perfLog(`${saveMs} ms taken in save source PDF ${index + 1} of ${total} (${source.name}, round trip)`);
    totals.add("save: source PDF(s), once each", saveMs);
  }

  const mapStart = perfNow();
  const maps = orders
    .filter((o) => o.mapping && backendIdByAwb.has(o.awb))
    .map((o) => ({
      orderId: backendIdByAwb.get(o.awb)!,
      docId: o.mapping!.docId,
      labelPages: o.mapping!.labelPages,
      invoicePages: o.mapping!.invoicePages,
    }));
  setProgress({ text: "Saving page map…" });
  const mapped = (
    (await PacklogService.mapOrders(packlogObjectId, maps)) as unknown as {
      data?: { data?: { jobId?: string | null; workers?: number } };
    }
  )?.data?.data;
  const mapMs = elapsed(mapStart);
  maps.forEach((m, i) => {
    const order = orders.find((o) => backendIdByAwb.get(o.awb) === m.orderId);
    perfLog(
      `${recordLabel("record", (order?.rowIndex ?? i) + 1, order?.awb)} label pages [${m.labelPages.map((p) => p + 1).join(",") || "-"}], invoice pages [${m.invoicePages.map((p) => p + 1).join(",") || "-"}] of ${m.docId} — nothing cut`
    );
  });
  perfLog(`${mapMs} ms taken in save page map (${maps.length} orders, one call)`);
  totals.add("save: page map (all orders)", mapMs);

  // Flipkart: the distribution code read off each label (B1, C1 …).
  const codes = orders
    .filter((o) => o.distributionCode && backendIdByAwb.has(o.awb))
    .map((o) => ({ orderId: backendIdByAwb.get(o.awb)!, code: o.distributionCode! }));
  if (codes.length) await PacklogService.setDistributionCodes(packlogObjectId, codes);

  // Per-order PDFs are cut in the background on N workers (Settings). Wait
  // only for the first N — one per worker; the rest carry on, visible under
  // Background process.
  let backgroundLeft = 0;
  if (mapped?.jobId) {
    const first = Math.max(1, Math.min(mapped.workers ?? 1, maps.length));
    setProgress({ text: `Saving the first ${first} record PDF(s)…` });
    const waitStart = perfNow();
    await window.printAgent.scanPack.waitForFirst(mapped.jobId, first);
    const waitMs = elapsed(waitStart);
    perfLog(`${waitMs} ms taken in wait for the first ${first} record PDF(s) — the rest continue in the background`);
    totals.add("save: first record PDF(s), before closing", waitMs);
    backgroundLeft = Math.max(0, maps.length - first);
  }

  return { packlogObjectId, total, failed, firstError, backgroundLeft };
};

/** The toasts that tell the operator how a new packlog came out. */
export const announcePacklogResult = (result: CreatePacklogResult) => {
  const { batch } = result;
  if (result.serverError) {
    toast(`Packlog saved locally. Server sync failed: ${result.serverError}`);
  } else if (result.saveFailed) {
    const { total, failed, firstError } = result.saveFailed;
    toast.error(
      `${total - failed} of ${total} file(s) saved to the Scan & Pack folder — ${failed} failed.${firstError ? ` ${firstError}` : ""}`
    );
  } else {
    toast.success(`Packlog ${batch.batchId} created — ${result.newlyMapped} of ${batch.orders.length} orders mapped.`);
  }
  if (result.stillUnmapped > 0) {
    toast(`${result.stillUnmapped} order(s) had no matching label. Use Bulk Update to top them up.`);
  }
  if (result.backgroundLeft > 0) {
    toast(
      `Ready to pack. ${result.backgroundLeft} more record PDF(s) are being saved in the background — see Background process.`,
      { duration: 6000 }
    );
  }
};

export const createPacklogFromFiles = async ({
  sheetFile,
  pdfFiles,
  platform,
  scanMode,
  sortKey = null,
  onProgress,
}: CreatePacklogInput): Promise<CreatePacklogResult> => {
  const setProgress = (progress: CreateProgress) => onProgress?.(progress);
  setProgress({ text: "Reading order list…" });
  const totals = new StageTotals();
  perfLog(`── Upload started: ${sheetFile.name} + ${pdfFiles.length} PDF(s), platform ${platform}, scan ${scanMode} ──`);

  try {
    let stepStart = perfNow();
    const sheet = await parseOrderSheet(sheetFile);
    const sheetMs = elapsed(stepStart);
    perfLog(`${sheetMs} ms taken in read order sheet (${sheet.rows.length} rows)`);
    totals.add("read order sheet", sheetMs);
    if (!sheet.rows.length) throw new Error("The order list has no data rows.");
    if (!sheet.awbHeader) throw new Error('No "Awb Number" column was found in the order list.');

    const batchId = generateBatchId();
    const scanned = await scanLabelPdfs(
      pdfFiles,
      platform,
      (_file, index) => `${batchId}:doc:${index}`,
      ({ page, totalPages, fileName, fileIndex, totalFiles }) =>
        setProgress({
          text:
            totalFiles > 1 ? `Scanning ${fileName} (file ${fileIndex + 1} of ${totalFiles})…` : `Scanning ${fileName}…`,
          done: page,
          total: totalPages,
          unit: "pages",
        }),
      { scanMode, totals }
    );

    setProgress({ text: "Matching AWBs…" });
    stepStart = perfNow();
    const orders = buildOrders(sheet, batchId);
    const match = applyScanReports(orders, scanned.map((doc) => doc.report));
    const matchMs = elapsed(stepStart);
    perfLog(`${matchMs} ms taken in match AWBs (${match.newlyMapped} of ${orders.length} rows matched)`);
    totals.add("match AWBs", matchMs);

    const now = new Date().toISOString();
    const documents: ScanPackDocument[] = scanned.map((doc, index) => ({
      id: `${batchId}:doc:${index}`,
      batchId,
      name: doc.fileName,
      platform,
      uploadedAt: now,
      bytes: doc.bytes,
    }));

    const batch: ScanPackBatch = {
      id: batchId,
      batchId,
      createdAt: now,
      updatedAt: now,
      platform,
      orderFileName: sheetFile.name,
      headers: sheet.headers,
      orders: match.orders,
      documentNames: documents.map((doc) => doc.name),
      scanMode,
      sortKey,
    };

    stepStart = perfNow();
    await saveDocuments(documents);
    await saveBatch(batch);
    const localMs = elapsed(stepStart);
    perfLog(`${localMs} ms taken in keep source PDF in browser storage (IndexedDB)`);
    totals.add("keep source PDF in browser storage", localMs);

    const result: CreatePacklogResult = {
      batch,
      packlogObjectId: null,
      newlyMapped: match.newlyMapped,
      stillUnmapped: match.stillUnmapped,
      saveFailed: null,
      serverError: null,
      backgroundLeft: 0,
    };
    // A failure here still leaves the local copy, so it is reported, not thrown.
    try {
      const saved = await persistPacklog(
        batch,
        match.orders,
        totals,
        documents.map((doc, index) => ({
          id: doc.id,
          name: doc.name,
          bytes: doc.bytes,
          pageCount: scanned[index]?.report.totalPages ?? 0,
        })),
        sortKey,
        setProgress
      );
      result.packlogObjectId = saved.packlogObjectId;
      result.backgroundLeft = saved.backgroundLeft;
      if (saved.failed > 0) result.saveFailed = { total: saved.total, failed: saved.failed, firstError: saved.firstError };
    } catch (err) {
      console.warn("[scan-and-pack] server persist failed — keeping local-only copy:", err);
      result.serverError = typeof err === "string" ? err : err instanceof Error ? err.message : "unknown error";
    }
    return result;
  } finally {
    totals.print("Upload finished");
  }
};
