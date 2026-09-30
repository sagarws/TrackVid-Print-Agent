import { Alert, Box, Divider, LinearProgress, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { CloudUploadOutlined, DescriptionOutlined, FileDownloadOutlined, LayersOutlined, ReceiptLongOutlined } from "@mui/icons-material";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import ButtonElement from "../common/Button";
import DialogShell from "./DialogShell";
import FileDropZone from "./FileDropZone";
import { PLATFORMS, getPlatform } from "../../utils/scan-and-pack/platforms";
import { parseOrderSheet } from "../../utils/scan-and-pack/sheet";
import { MAX_PDF_BYTES, MAX_PDF_MB, formatMb, scanLabelPdfs } from "../../utils/scan-and-pack/pdf-scan";
import { applyScanReports, buildOrders, generateBatchId } from "../../utils/scan-and-pack/batch";
import { saveBatch, saveDocuments } from "../../utils/scan-and-pack/db";
import { buildOrderPdf } from "../../utils/scan-and-pack/pdf-output";
import { elapsed, now as perfNow, perfLog, recordLabel, StageTotals } from "../../utils/scan-and-pack/perf";
import { PacklogService } from "../../api/packlog-service";
import type { ScanMode, ScanPackBatch, ScanPackDocument } from "../../types/scanAndPack.types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (batch: ScanPackBatch) => void;
}

const SHEET_ACCEPT = ".csv,.xlsx,.xls";
const PDF_ACCEPT = ".pdf";

const UploadSessionModal = ({ open, onClose, onCreated }: Props) => {
  const [platform, setPlatform] = useState("amazon");
  const [scanMode, setScanMode] = useState<ScanMode>("both");
  const [sheetFiles, setSheetFiles] = useState<File[]>([]);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);

  const [busy, setBusy] = useState(false);
  // What the upload is doing, and — for a step with a known size — how far
  // it has got, so the bar fills and the operator sees "3 / 10 completed".
  const [progress, setProgressState] = useState<{
    text: string;
    done?: number;
    total?: number;
    /** What is being counted: "pages", "orders", "files". */
    unit?: string;
  }>({ text: "" });
  const setProgress = (text: string, count?: { done: number; total: number; unit: string }) =>
    setProgressState({ text, ...count });

  // Which scan modes the chosen platform's config can actually deliver.
  // Flipkart PDFs are label-only (no invoice pages ever), so the operator can
  // only pick "Label"; other platforms support all three.
  const modeCapabilities = useMemo(() => {
    const config = getPlatform(platform);
    const canInvoice = Boolean(config?.isInvoicePage && config?.awbFromInvoiceText);
    return {
      label: true,
      invoice: canInvoice,
      both: canInvoice,
    };
  }, [platform]);

  // Snap the current mode back to a supported one whenever the platform
  // changes (e.g. switching to Flipkart with "invoice" selected).
  useEffect(() => {
    if (!modeCapabilities[scanMode]) setScanMode("label");
  }, [modeCapabilities, scanMode]);

  /**
   * Keeps oversized PDFs out of state entirely.
   *
   * `scanLabelPdf` refuses them too, but only once processing starts — by which
   * point the operator has chosen a platform, dropped a sheet, waited, and
   * watched it fail. Saying so at the moment of the drop is the difference
   * between a typo and a wasted setup, and it also means the browser is never
   * holding a File it has already decided not to read.
   *
   * Oversized files are dropped and named; the rest are kept, so one bad file
   * in a multi-file drop does not discard the good ones.
   */
  const acceptPdfFiles = (next: File[]) => {
    const tooBig = next.filter((file) => file.size > MAX_PDF_BYTES);

    if (tooBig.length > 0) {
      toast.error(
        `${tooBig.map((f) => `"${f.name}" (${formatMb(f.size)})`).join(", ")} ` +
          `exceeds the ${MAX_PDF_MB}MB limit and was not added. Split it and try again.`,
      );
    }

    setPdfFiles(next.filter((file) => file.size <= MAX_PDF_BYTES));
  };

  // Scanning is a long async walk over every PDF page; if the operator closes
  // the modal midway we must not touch state on an unmounted component.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reset = () => {
    setSheetFiles([]);
    setPdfFiles([]);
    setProgress("");
  };

  /**
   * Emit an XLSX with the header row operators are expected to fill in. Values
   * are left blank so the template doubles as an authoring starting point.
   */
  const downloadTemplate = () => {
    const headers = [
      "OMS SKU",
      "Listing SKU",
      "Listing ID",
      "Quantity",
      "Forward AWB",
      "Shipping Label",
      "Invoice",
    ];
    const worksheet = XLSX.utils.aoa_to_sheet([headers]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");
    XLSX.writeFile(workbook, "packlog-template.xlsx");
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  /**
   * Mirror a freshly-created batch to the server: `POST /packlog` for the
   * metadata, then per-order multipart uploads for every mapped label /
   * invoice PDF (built on the fly with `buildOrderPdf`).
   *
   * The caller AWAITS this so the modal only closes once the record + all
   * S3 uploads are in place. That way when the list refetches on `onCreated`,
   * the new row already shows the final `mappedCount` — no "0 / 13 → refresh
   * → 2 / 13" surprise. Uploads run in parallel so the wait is bounded to a
   * few seconds even for a full batch.
   *
   * Individual upload failures are logged but don't reject the whole call
   * (Promise.allSettled): one bad order shouldn't tank the rest, and the
   * BE-side `mappedCount` will still reflect the successful ones.
   */
  const persistPacklogToServer = async (
    batch: ScanPackBatch,
    orders: ScanPackBatch["orders"],
    totals: StageTotals
  ): Promise<{ total: number; failed: number; firstError: string | null }> => {
    const createStart = perfNow();
    // Two-level unwrap: the shared axios helper returns the raw AxiosResponse
    // (so `.data` is the BE envelope), and the BE envelope wraps its payload
    // in another `.data`. Real fields live at `response.data.data.*`.
    const raw = await PacklogService.createPacklog({
      packlogId: batch.batchId,
      platform: batch.platform,
      scanMode: batch.scanMode ?? "both",
      orderFileName: batch.orderFileName,
      headers: batch.headers,
      orders: orders.map((o) => ({
        rowIndex: o.rowIndex,
        awb: o.awb,
        awbRaw: o.awbRaw,
        rawRow: o.raw,
      })),
    });
    const payload = (
      raw as unknown as {
        data?: {
          data?: {
            id?: string;
            orders?: { rowIndex: number; awb: string; id: string }[];
          };
        };
      }
    )?.data?.data;
    const createMs = elapsed(createStart);
    perfLog(`${createMs} ms taken in create packlog record (${orders.length} rows)`);
    totals.add("save: create packlog record", createMs);
    const packlogBackendId = String(payload?.id ?? "");
    const backendOrders = payload?.orders ?? [];
    const backendIdByAwb = new Map(backendOrders.map((o) => [o.awb, o.id]));

    if (!packlogBackendId) {
      throw new Error("Server did not return a packlog id — packlog not saved to server.");
    }

    // Collect one upload per (order, part). Building the sliced PDF is the
    // slow bit (pdf-lib + IndexedDB read), so we do that for every job first
    // and hand the bytes to a bounded-concurrency runner.
    interface UploadJob {
      backendId: string;
      part: "label" | "invoice";
      pageCount: number;
      awb: string;
      bytes: Uint8Array;
      /** 1-based sheet row, for the time log. */
      record: number;
    }
    const jobs: UploadJob[] = [];
    const toPrepare = orders.filter((o) => o.mapping && backendIdByAwb.has(o.awb));
    for (const [index, order] of toPrepare.entries()) {
      if (!order.mapping) continue;
      const backendId = backendIdByAwb.get(order.awb);
      if (!backendId) continue;
      if (aliveRef.current) {
        setProgress("Preparing label & invoice PDFs…", { done: index, total: toPrepare.length, unit: "orders" });
      }
      const record = order.rowIndex + 1;
      const label = recordLabel("record", record, order.awb || order.awbRaw);
      // One line per step of cutting this order's PDF out of the source.
      const timed = (part: "label" | "invoice") => (t: {
        readSourceMs: number;
        loadSourceMs: number;
        copyAndSaveMs: number;
        sourceKb: number;
        reused: boolean;
      }) => {
        if (t.reused) {
          perfLog(`${label} 0 ms taken in prepare-${part}: source PDF already parsed (reused)`);
        } else {
          perfLog(`${label} ${t.readSourceMs} ms taken in prepare-${part}: read source PDF from browser storage (${t.sourceKb} KB)`);
          perfLog(`${label} ${t.loadSourceMs} ms taken in prepare-${part}: parse whole source PDF once (pdf-lib)`);
        }
        perfLog(`${label} ${t.copyAndSaveMs} ms taken in prepare-${part}: copy ${part} page(s) + build new PDF`);
        totals.add("prepare: read source from browser storage", t.readSourceMs);
        totals.add("prepare: parse whole source PDF", t.loadSourceMs);
        totals.add("prepare: copy pages + build PDF", t.copyAndSaveMs);
      };
      try {
        if (order.mapping.labelPages.length > 0) {
          jobs.push({
            backendId,
            part: "label",
            pageCount: order.mapping.labelPages.length,
            awb: order.awb || order.awbRaw,
            bytes: await buildOrderPdf(order, "label", timed("label")),
            record,
          });
        }
        if (order.mapping.invoicePages.length > 0) {
          jobs.push({
            backendId,
            part: "invoice",
            pageCount: order.mapping.invoicePages.length,
            awb: order.awb || order.awbRaw,
            bytes: await buildOrderPdf(order, "invoice", timed("invoice")),
            record,
          });
        }
      } catch (err) {
        console.warn(`[scan-and-pack] failed to slice ${order.awb}:`, err);
      }
    }

    if (!jobs.length) return { total: 0, failed: 0, firstError: null };

    if (aliveRef.current) {
      setProgress("Uploading files to server…", { done: 0, total: jobs.length, unit: "files" });
    }

    // Bounded parallelism: 6 concurrent requests. Enough to saturate a
    // packing-desk uplink without stampeding a slow one.
    const CONCURRENCY = 6;
    let completed = 0;
    let failed = 0;
    let firstError: string | null = null;
    const runOne = async (job: UploadJob) => {
      const saveStart = perfNow();
      try {
        await PacklogService.uploadPart(
          packlogBackendId,
          job.backendId,
          job.part,
          job.bytes,
          job.pageCount,
          job.awb
        );
      } catch (err) {
        failed++;
        // The axios interceptor rejects with the server's displayMessage as a
        // string (e.g. "Google Drive access has expired…"); keep the first one
        // so the operator is told why, not just that something failed.
        firstError ??= typeof err === "string" ? err : err instanceof Error ? err.message : null;
        console.warn(`[scan-and-pack] failed to upload ${job.part}-${job.awb}:`, err);
      } finally {
        const saveMs = elapsed(saveStart);
        perfLog(
          `${recordLabel("record", job.record, job.awb)} ${saveMs} ms taken in save-${job.part}: send to app + write to folder (round trip, ${Math.round(job.bytes.byteLength / 1024)} KB, up to ${CONCURRENCY} in parallel)`
        );
        totals.add("save: send + write each PDF (round trip)", saveMs);
        completed++;
        if (aliveRef.current) {
          setProgress(
            failed
              ? `Uploading files to server… ${failed} failed`
              : "Uploading files to server…",
            { done: completed, total: jobs.length, unit: "files" }
          );
        }
      }
    };

    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        if (!job) return;
        await runOne(job);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
    return { total: jobs.length, failed, firstError };
  };

  const handleSubmit = async () => {
    const sheetFile = sheetFiles[0];
    if (!sheetFile) return toast.error("Select the order list (CSV/XLSX) first.");
    if (!pdfFiles.length) return toast.error("Select at least one label & invoice PDF.");

    setBusy(true);
    setProgress("Reading order list…");
    // AGENT ADDITION: time every step, per record, in the app's terminal.
    const totals = new StageTotals();
    perfLog(`── Upload started: ${sheetFile.name} + ${pdfFiles.length} PDF(s), platform ${platform}, scan ${scanMode} ──`);

    try {
      let stepStart = perfNow();
      const sheet = await parseOrderSheet(sheetFile);
      const sheetMs = elapsed(stepStart);
      perfLog(`${sheetMs} ms taken in read order sheet (${sheet.rows.length} rows)`);
      totals.add("read order sheet", sheetMs);
      if (!sheet.rows.length) throw new Error("The order list has no data rows.");
      if (!sheet.awbHeader) {
        throw new Error('No "Forward AWB" column was found in the order list.');
      }

      const batchId = generateBatchId();
      const scanned = await scanLabelPdfs(
        pdfFiles,
        platform,
        (_file, index) => `${batchId}:doc:${index}`,
        ({ page, totalPages, fileName, fileIndex, totalFiles }) => {
          if (!aliveRef.current) return;
          setProgress(
            totalFiles > 1
              ? `Scanning ${fileName} (file ${fileIndex + 1} of ${totalFiles})…`
              : `Scanning ${fileName}…`,
            { done: page, total: totalPages, unit: "pages" }
          );
        },
        { scanMode, totals }
      );

      if (!aliveRef.current) return;
      setProgress("Matching AWBs…");

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
      };

      stepStart = perfNow();
      await saveDocuments(documents);
      await saveBatch(batch);
      const localMs = elapsed(stepStart);
      perfLog(`${localMs} ms taken in keep source PDF in browser storage (IndexedDB)`);
      totals.add("keep source PDF in browser storage", localMs);

      // Persist to the server AND wait for every Drive upload to finish before
      // closing the modal. This is the critical ordering: `onCreated` triggers
      // the packlog-list refetch, and if we let it fire before uploads are in
      // place, the operator sees "0 / 13" until they manually reload. Uploads
      // run in parallel inside `persistPacklogToServer` so the wait is short.
      //
      // A server-side failure still lets the operator pack from IndexedDB —
      // we surface it as a toast but do NOT roll back the local batch or the
      // "Packlog created" success message.
      let serverPersistFailed = false;
      try {
        const uploaded = await persistPacklogToServer(batch, match.orders, totals);
        if (uploaded.failed > 0) {
          serverPersistFailed = true;
          if (aliveRef.current) {
            toast.error(
              `${uploaded.total - uploaded.failed} of ${uploaded.total} file(s) saved to the Scan & Pack folder — ${uploaded.failed} failed.${uploaded.firstError ? ` ${uploaded.firstError}` : ""}`
            );
          }
        }
      } catch (err) {
        serverPersistFailed = true;
        console.warn("[scan-and-pack] server persist failed — keeping local-only copy:", err);
        if (aliveRef.current) {
          toast(
            typeof err === "string"
              ? `Packlog saved locally. Server sync failed: ${err}`
              : `Packlog saved locally. Server sync failed — will retry when possible.`
          );
        }
      }

      if (!aliveRef.current) return;
      if (!serverPersistFailed) {
        toast.success(
          `Packlog ${batchId} created — ${match.newlyMapped} of ${match.orders.length} orders mapped.`
        );
      }
      if (match.stillUnmapped > 0) {
        toast(`${match.stillUnmapped} order(s) had no matching label. Use Bulk Update to top them up.`);
      }
      reset();
      onCreated(batch);
    } catch (error) {
      if (aliveRef.current) {
        toast.error(error instanceof Error ? error.message : "Could not process the upload.");
      }
    } finally {
      totals.print("Upload finished");
      if (aliveRef.current) {
        setBusy(false);
        setProgress("");
      }
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={handleClose}
      busy={busy}
      title="Upload Packlog files"
      subtitle="Order list + label/invoice PDFs — matched by Forward AWB"
      icon={<CloudUploadOutlined />}
      footer={
        <>
          <ButtonElement
            type="button"
            variant="outlined"
            size="small"
            onClick={handleClose}
            disabled={busy}
            sx={{ color: "text.primary", textTransform: "none", fontSize: 13, fontWeight: 500, px: 2, minWidth: 100, minHeight: 32 }}
          >
            Cancel
          </ButtonElement>
          <ButtonElement
            type="button"
            variant="contained"
            size="small"
            loading={busy}
            disabled={busy || !sheetFiles.length || !pdfFiles.length}
            onClick={handleSubmit}
            sx={{ color: "white", textTransform: "none", fontSize: 13, fontWeight: 600, px: 2.5, minHeight: 32, minWidth: 150 }}
          >
            Create Packlog
          </ButtonElement>
        </>
      }
    >
      <TextField
        select
        size="small"
        label="Platform"
        value={platform}
        disabled={busy}
        onChange={(event) => setPlatform(event.target.value)}
      >
        {PLATFORMS.map((option) => (
          <MenuItem key={option.key} value={option.key} disabled={!option.enabled}>
            {option.label}
            {!option.enabled && (
              <Typography component="span" sx={{ fontSize: 11, color: "text.secondary", ml: 1 }}>
                (coming soon)
              </Typography>
            )}
          </MenuItem>
        ))}
      </TextField>

      {/*
        Order-list section. Groups the drop zone with its "Download Template"
        helper so operators reading top-to-bottom see the template right where
        they'd realise they don't have one yet, instead of hunting for it above
        the dropzone.
      */}
      <Stack spacing={1}>
        <FileDropZone
          label="1. Order list"
          accept={SHEET_ACCEPT}
          files={sheetFiles}
          onChange={setSheetFiles}
          disabled={busy}
          hint="CSV or XLSX with OMS SKU, Listing SKU, Listing ID, Quantity, Forward AWB, Shipping Label, Invoice"
        />
        <Stack direction="row" alignItems="center" spacing={1} sx={{ pl: 0.25 }}>
          <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
            Need the header row?
          </Typography>
          <ButtonElement
            type="button"
            variant="text"
            size="small"
            onClick={downloadTemplate}
            disabled={busy}
            startIcon={<FileDownloadOutlined sx={{ fontSize: 14 }} />}
            sx={{
              color: "primary.main",
              textTransform: "none",
              fontSize: 12,
              fontWeight: 600,
              minHeight: 24,
              px: 0.5,
              "& .MuiButton-startIcon": { mr: 0.5 },
            }}
          >
            Download Template
          </ButtonElement>
        </Stack>
      </Stack>

      {/* Visual break between the two numbered sections so the eye doesn't
          slide from the order list straight into the PDF dropzone. */}
      <Divider flexItem />

      {/*
        Label & invoice section. Section heading is rendered manually so the
        "Scan target" toggle can sit BETWEEN the heading and the dropzone as
        a sub-heading — operators pick "Label / Invoice / Both" here to
        decide what the scanner extracts from the PDFs at upload time. The
        Pack page has its own toggle that decides what to print/download,
        constrained by whatever was scanned here.
      */}
      <Stack spacing={1}>
        <Typography
          sx={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", color: "text.secondary" }}
        >
          2. Label &amp; invoice PDFs
        </Typography>

        <Stack spacing={0.5} sx={{ pl: 1 }}>
          <Typography
            sx={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: "text.secondary", opacity: 0.85 }}
          >
            Scan target
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={scanMode}
            onChange={(_, next: ScanMode | null) => { if (next) setScanMode(next); }}
            disabled={busy}
            sx={{
              "& .MuiToggleButton-root": {
                flex: 1,
                textTransform: "none",
                fontSize: 12,
                fontWeight: 600,
                gap: 0.5,
                py: 0.5,
                borderColor: (t) => t.palette.divider,
                color: "text.secondary",
              },
              "& .Mui-selected": {
                color: "primary.main",
                bgcolor: "rgba(0,136,163,0.10) !important",
                borderColor: "primary.main !important",
              },
            }}
          >
            <ToggleButton value="label" disabled={!modeCapabilities.label}>
              <DescriptionOutlined sx={{ fontSize: 14 }} /> Label
            </ToggleButton>
            <ToggleButton value="invoice" disabled={!modeCapabilities.invoice}>
              <ReceiptLongOutlined sx={{ fontSize: 14 }} /> Invoice
            </ToggleButton>
            <ToggleButton value="both" disabled={!modeCapabilities.both}>
              <LayersOutlined sx={{ fontSize: 14 }} /> Both
            </ToggleButton>
          </ToggleButtonGroup>
          {!modeCapabilities.both && (
            <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
              Flipkart PDFs carry only shipping labels — Invoice and Both are unavailable for this platform.
            </Typography>
          )}
        </Stack>

        <FileDropZone
          accept={PDF_ACCEPT}
          multiple
          files={pdfFiles}
          onChange={acceptPdfFiles}
          disabled={busy}
          hint={`One or more PDFs, up to ${MAX_PDF_MB}MB each. Each label page is followed by its invoice page(s).`}
        />
      </Stack>

      {busy && (
        <Box>
          {progress.total ? (
            <LinearProgress
              variant="determinate"
              value={Math.min(100, ((progress.done ?? 0) / progress.total) * 100)}
              sx={{ borderRadius: "6px", height: 6 }}
            />
          ) : (
            <LinearProgress sx={{ borderRadius: "6px", height: 6 }} />
          )}
          <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ mt: 0.75 }}>
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
              {progress.text || "Working…"}
            </Typography>
            {progress.total ? (
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: "text.primary", whiteSpace: "nowrap" }}>
                {progress.done ?? 0} / {progress.total} {progress.unit} completed
              </Typography>
            ) : null}
          </Stack>
        </Box>
      )}

      {!busy && (
        <Alert
          severity="info"
          variant="outlined"
          sx={{ borderRadius: "6px", "& .MuiAlert-message": { fontSize: 12 }, "& .MuiAlert-icon": { fontSize: 18 } }}
        >
          <Stack spacing={0.25}>
            <span>
              Label pages are read from their text layer where possible and rasterised for barcode
              decoding otherwise. Large PDFs can take a few seconds per page.
            </span>
            <span>Each label page is paired with the pages that follow it as its invoice — Flipkart PDFs are label-only.</span>
            <span>Rows whose AWB is not found stay unmapped — top them up later with Bulk Update.</span>
          </Stack>
        </Alert>
      )}
    </DialogShell>
  );
};

export default UploadSessionModal;
