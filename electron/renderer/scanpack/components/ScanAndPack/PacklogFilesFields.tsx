import { Alert, Box, Divider, LinearProgress, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { DescriptionOutlined, FileDownloadOutlined, LayersOutlined, ReceiptLongOutlined } from "@mui/icons-material";
import { useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import ButtonElement from "../common/Button";
import FileDropZone from "./FileDropZone";
import { getPlatform } from "../../utils/scan-and-pack/platforms";
import { MAX_PDF_BYTES, MAX_PDF_MB, formatMb } from "../../utils/scan-and-pack/pdf-scan";
import type { CreateProgress } from "../../utils/scan-and-pack/create-packlog";
import type { ScanMode } from "../../types/scanAndPack.types";

const SHEET_ACCEPT = ".csv,.xlsx,.xls";
const PDF_ACCEPT = ".pdf";

interface Props {
  platform: string;
  scanMode: ScanMode;
  setScanMode: (mode: ScanMode) => void;
  sheetFiles: File[];
  setSheetFiles: (files: File[]) => void;
  pdfFiles: File[];
  setPdfFiles: (files: File[]) => void;
  busy: boolean;
}

/**
 * The order list + label/invoice PDF inputs of a new packlog, shared by the
 * Upload Packlog modal and the Label Sorting page.
 */
export const PacklogFilesFields = ({
  platform,
  scanMode,
  setScanMode,
  sheetFiles,
  setSheetFiles,
  pdfFiles,
  setPdfFiles,
  busy,
}: Props) => {
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
  }, [modeCapabilities, scanMode, setScanMode]);

  /**
   * Keeps oversized PDFs out of state entirely, at the moment of the drop
   * rather than once processing starts. Oversized files are dropped and
   * named; the rest are kept.
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

  /**
   * Emit an XLSX with the header row operators are expected to fill in. Values
   * are left blank so the template doubles as an authoring starting point.
   */
  const downloadTemplate = () => {
    const headers = [
      "OMS SKU",
      // AGENT CHANGE: "Listing SKU" → "SKU", "Forward AWB" → "Awb Number".
      // Sheets with the old names are still read (sheet.ts, pack page).
      "SKU",
      "Listing ID",
      "Quantity",
      "Awb Number",
      "Shipping Label",
      "Invoice",
    ];
    const worksheet = XLSX.utils.aoa_to_sheet([headers]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");
    XLSX.writeFile(workbook, "packlog-template.xlsx");
  };

  return (
    <>
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
          hint="CSV or XLSX with OMS SKU, SKU, Listing ID, Quantity, Awb Number, Shipping Label, Invoice"
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
          {/* AGENT: where the AWB is found for this platform, whatever the
              target — the target only picks which pages each order keeps. */}
          {(() => {
            const config = getPlatform(platform);
            if (!config) return null;
            const anchor =
              config.useInvoiceAsAnchor && config.isInvoicePage && config.awbFromInvoiceText ? "invoice" : "label";
            const keeps =
              scanMode === "both"
                ? "each order keeps its label and its invoice"
                : scanMode === anchor
                ? `each order keeps its ${anchor}`
                : anchor === "label"
                ? "each order keeps the invoice page(s) after its label"
                : "each order keeps the label page just before its invoice";
            return (
              <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
                {config.label}: the AWB is found on the <b>{anchor}</b>
                {anchor === "invoice" ? " (its text)" : " (its text, or barcode)"}; with{" "}
                <b>{scanMode === "both" ? "Both" : scanMode === "label" ? "Label" : "Invoice"}</b>, {keeps}.
              </Typography>
            );
          })()}
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
    </>
  );
};

export const PacklogUploadInfo = () => (
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
);

/** The bar and "3 / 10 pages completed" under a running packlog upload. */
export const PacklogProgress = ({ progress }: { progress: CreateProgress }) => (
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
);
