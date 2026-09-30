import { Alert, Box, LinearProgress, MenuItem, TextField, Typography } from "@mui/material";
import { PublishedWithChangesOutlined } from "@mui/icons-material";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import ButtonElement from "../common/Button";
import DialogShell from "./DialogShell";
import FileDropZone from "./FileDropZone";
import { PLATFORMS } from "../../utils/scan-and-pack/platforms";
import { scanLabelPdfs } from "../../utils/scan-and-pack/pdf-scan";
import { applyScanReports } from "../../utils/scan-and-pack/batch";
import { saveBatch, saveDocuments } from "../../utils/scan-and-pack/db";
import { buildOrderPdf } from "../../utils/scan-and-pack/pdf-output";
import { PacklogService } from "../../api/packlog-service";
import type { ScanPackBatch, ScanPackDocument } from "../../types/scanAndPack.types";

interface Props {
  open: boolean;
  batch: ScanPackBatch;
  onClose: () => void;
  /**
   * Fired once the mapping is on the server. Takes no batch: the caller must
   * refetch, because the server is now the source of truth and a locally
   * patched object would hide any upload that failed.
   */
  onUpdated: () => void;
}

const BulkUpdateModal = ({ open, batch, onClose, onUpdated }: Props) => {
  // Not state: a bulk update always re-scans against the packlog's own
  // marketplace, so there is nothing for the operator to choose.
  const platform = batch.platform;
  const platformLabel =
    PLATFORMS.find((option) => option.key === platform)?.label ?? platform;
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const unmappedCount = batch.orders.filter((order) => !order.mapping).length;

  const handleClose = () => {
    if (busy) return;
    setPdfFiles([]);
    setProgress("");
    onClose();
  };

  /**
   * Push the freshly-mapped orders' PDFs to the server.
   *
   * This is the half that used to be missing: Bulk Update wrote the mapping
   * to IndexedDB and stopped, while the packlog screens read from the BE. The
   * rows flipped to Mapped until the next reload, and the pack flow still
   * refused them because `downloadPart` looks in S3, not in this browser.
   *
   * The packlog and its order rows already exist server-side, so unlike the
   * create flow there is nothing to POST first — `batch.id` is the packlog's
   * Mongo `_id` and `order.id` is the order row's, straight off
   * `adaptPacklogDetail`. Each part is sliced out of the stored source PDF
   * and uploaded on its own.
   *
   * One failure does not abort the rest: a single unreadable page should not
   * cost the operator the other forty parcels. The count comes back so the
   * caller can tell the operator the truth instead of a blanket success.
   */
  const uploadNewMappings = async (
    orders: ScanPackBatch["orders"]
  ): Promise<{ total: number; ok: number; failed: number; firstError: string | null }> => {
    interface UploadJob {
      orderId: string;
      part: "label" | "invoice";
      pageCount: number;
      awb: string;
      bytes: Uint8Array;
    }

    const jobs: UploadJob[] = [];
    for (const order of orders) {
      if (!order.mapping) continue;
      const awb = order.awb || order.awbRaw;
      for (const part of ["label", "invoice"] as const) {
        const pageCount =
          part === "label" ? order.mapping.labelPages.length : order.mapping.invoicePages.length;
        if (!pageCount) continue;
        try {
          jobs.push({
            orderId: order.id,
            part,
            pageCount,
            awb,
            bytes: await buildOrderPdf(order, part),
          });
        } catch (err) {
          console.warn(`[scan-and-pack] failed to slice ${part} for ${awb}:`, err);
        }
      }
    }

    if (!jobs.length) return { total: 0, ok: 0, failed: 0, firstError: null };

    if (aliveRef.current) {
      setProgress(`Uploading ${jobs.length} file${jobs.length === 1 ? "" : "s"} to server…`);
    }

    // Bounded parallelism, same 6 as the create flow: enough to saturate a
    // packing-desk uplink without stampeding a slow one.
    const CONCURRENCY = 6;
    let ok = 0;
    let failed = 0;
    let firstError: string | null = null;
    let cursor = 0;

    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        if (!job) return;
        try {
          await PacklogService.uploadPart(
            batch.id,
            job.orderId,
            job.part,
            job.bytes,
            job.pageCount,
            job.awb
          );
          ok++;
        } catch (err) {
          failed++;
          // Keep the server's reason (e.g. Google Drive access expired) for the toast.
          firstError ??= typeof err === "string" ? err : err instanceof Error ? err.message : null;
          console.warn(`[scan-and-pack] failed to upload ${job.part}-${job.awb}:`, err);
        }
        if (aliveRef.current) setProgress(`Uploading ${ok + failed} / ${jobs.length}…`);
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
    return { total: jobs.length, ok, failed, firstError };
  };

  const handleSubmit = async () => {
    if (!pdfFiles.length) return toast.error("Select at least one label & invoice PDF.");

    setBusy(true);
    setProgress("Preparing…");

    try {
      // Doc ids are suffixed with the current document count so a second bulk
      // update never overwrites the PDFs stored by the first.
      const offset = batch.documentNames.length;
      const scanned = await scanLabelPdfs(
        pdfFiles,
        platform,
        (_file, index) => `${batch.id}:doc:${offset + index}`,
        ({ page, totalPages, fileName, fileIndex, totalFiles }) => {
          if (!aliveRef.current) return;
          setProgress(`Scanning ${fileName} (${fileIndex + 1}/${totalFiles}) — page ${page} of ${totalPages}`);
        }
      );

      if (!aliveRef.current) return;
      setProgress("Matching AWBs…");

      // Only rows without a mapping are considered — see applyScanReports.
      const match = applyScanReports(batch.orders, scanned.map((doc) => doc.report));

      // Exactly the rows THIS pass filled. Re-uploading a PDF whose AWBs are
      // already mapped must not re-upload their PDFs to Google Drive.
      const wasMapped = new Map(batch.orders.map((order) => [order.id, Boolean(order.mapping)]));
      const newlyMappedOrders = match.orders.filter(
        (order) => order.mapping && !wasMapped.get(order.id)
      );

      const now = new Date().toISOString();
      const documents: ScanPackDocument[] = scanned.map((doc, index) => ({
        id: `${batch.id}:doc:${offset + index}`,
        batchId: batch.id,
        name: doc.fileName,
        platform,
        uploadedAt: now,
        bytes: doc.bytes,
      }));

      const next: ScanPackBatch = {
        ...batch,
        updatedAt: now,
        orders: match.orders,
        documentNames: [...batch.documentNames, ...documents.map((doc) => doc.name)],
      };

      // IndexedDB first, and not as the destination: `buildOrderPdf` slices
      // each order's pages out of the stored source PDF, so the bytes have to
      // be readable before the upload loop below can run.
      await saveDocuments(documents);
      await saveBatch(next);

      const uploaded = await uploadNewMappings(newlyMappedOrders);
      if (!aliveRef.current) return;

      if (match.newlyMapped > 0) {
        if (uploaded.failed > 0) {
          toast.error(
            `${uploaded.ok} of ${uploaded.total} file(s) saved to the server — ${uploaded.failed} failed. Re-run Bulk Update for the rows still showing No.${uploaded.firstError ? ` ${uploaded.firstError}` : ""}`
          );
        } else {
          toast.success(`${match.newlyMapped} order(s) mapped. ${match.stillUnmapped} still pending.`);
        }
      } else {
        toast.error("No new order could be mapped from these PDFs.");
      }
      if (match.unmatchedAwbs.length) {
        toast(`${match.unmatchedAwbs.length} AWB(s) in the PDFs are not present in this batch.`);
      }
      setPdfFiles([]);
      onUpdated();
    } catch (error) {
      if (aliveRef.current) {
        toast.error(error instanceof Error ? error.message : "Could not process the PDFs.");
      }
    } finally {
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
      title="Bulk Update Labels & Invoices"
      subtitle={`Packlog ${batch.batchId} — ${unmappedCount} order(s) still unmapped`}
      icon={<PublishedWithChangesOutlined />}
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
            disabled={busy || !pdfFiles.length || unmappedCount === 0}
            onClick={handleSubmit}
            sx={{ color: "white", textTransform: "none", fontSize: 13, fontWeight: 600, px: 2.5, minHeight: 32, minWidth: 150 }}
          >
            Re-check & Update
          </ButtonElement>
        </>
      }
    >
      {/* Locked to the packlog's own platform. The AWB patterns and page
          layout the scanner matches against are per-marketplace, so running
          this pass as anything other than what the packlog was created as
          would read the labels with the wrong rules and map nothing — or
          worse, map the wrong rows. Shown rather than hidden so the operator
          can see which marketplace the pass will use. */}
      <TextField
        select
        size="small"
        label="Platform"
        value={platform}
        disabled
        helperText={`Fixed to this packlog's marketplace (${platformLabel}).`}
        FormHelperTextProps={{ sx: { fontSize: 11, mt: 0.5 } }}
      >
        <MenuItem value={platform}>{platformLabel}</MenuItem>
      </TextField>

      <FileDropZone
        label="New label & invoice PDFs"
        accept=".pdf"
        multiple
        files={pdfFiles}
        onChange={setPdfFiles}
        disabled={busy}
        hint="Only the orders that are still unmapped will be updated."
      />

      {busy && (
        <Box>
          <LinearProgress sx={{ borderRadius: "6px", height: 6 }} />
          <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.75 }}>
            {progress || "Working…"}
          </Typography>
        </Box>
      )}

      {!busy && unmappedCount === 0 && (
        <Alert
          severity="success"
          variant="outlined"
          sx={{ borderRadius: "6px", "& .MuiAlert-message": { fontSize: 12 }, "& .MuiAlert-icon": { fontSize: 18 } }}
        >
          Every order in this batch already has a label and invoice mapped.
        </Alert>
      )}
    </DialogShell>
  );
};

export default BulkUpdateModal;
