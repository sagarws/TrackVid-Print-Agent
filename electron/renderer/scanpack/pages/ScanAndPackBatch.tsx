import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  Typography,
} from "@mui/material";
import type { GridColDef } from "@mui/x-data-grid";
import {
  ArrowBack,
  FileDownloadOutlined,
  PublishedWithChangesOutlined,
  QrCodeScannerOutlined,
  Search,
  VisibilityOutlined,
} from "@mui/icons-material";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import { Page } from "./Page";
import DataTable from "../components/common/DataTable";
import ButtonElement from "../components/common/Button";
import TextInput from "../components/common/TextInput";
import BulkUpdateModal from "../components/ScanAndPack/BulkUpdateModal";
import PdfPreviewModal from "../components/ScanAndPack/PdfPreviewModal";
import { PacklogService, adaptPacklogDetail } from "../api/packlog-service";
import { PackStatusChip, ReprintButton } from "../components/ScanAndPack/PackStatusCells";
import { countMapped } from "../utils/scan-and-pack/batch";
import {
  dispatchPrint,
  readOutputMode,
  findPrintTargetMismatch,
  readStoredTarget,
  type PrintTargetMismatch,
} from "../utils/scan-and-pack/print-dispatch";
import PrintTargetMismatchDialog from "../components/ScanAndPack/PrintTargetMismatchDialog";
import PrinterSetupModal from "../components/ScanAndPack/PrinterSetupModal";
import { getPlatform } from "../utils/scan-and-pack/platforms";
import ROUTE_URLS from "../config/route";
import type { PackStatus, ScanPackBatch } from "../types/scanAndPack.types";

const MAPPED_FIELD = "__mapped__";
const LABEL_COUNT_FIELD = "__labelCount__";
const INVOICE_COUNT_FIELD = "__invoiceCount__";
const PACK_STATUS_FIELD = "__packStatus__";
const PACKED_AT_FIELD = "__packedAt__";
const ACTIONS_FIELD = "__actions__";
type StatusFilter = "all" | "mapped" | "unmapped" | "ready" | "packed";

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "mapped", label: "Mapped" },
  { key: "unmapped", label: "Not Mapped" },
  { key: "ready", label: "Ready to pack" },
  { key: "packed", label: "Packed" },
];

// The uploaded sheet almost always carries "Shipping Label", "Invoice" and
// "Platform" columns that either duplicate our own status (Label/Invoice) or are
// already implied by the batch (Platform). The grid and the export both hide them.
const HIDDEN_HEADER_RE = /^(shipping\s*label|invoice|platform)$/i;
const isVisibleHeader = (header: string) =>
  !HIDDEN_HEADER_RE.test(header.replace(/[\s_]+/g, " ").trim());

const matchesStatus = (order: ScanPackBatch["orders"][number], status: StatusFilter) => {
  if (status === "mapped") return Boolean(order.mapping);
  if (status === "unmapped") return !order.mapping;
  // Anything not literally "packed" is ready, as the Pack Status column shows it.
  if (status === "ready") return order.packStatus !== "packed";
  if (status === "packed") return order.packStatus === "packed";
  return true;
};

const EXPORT_SHEET_COLUMNS = [
  "Order Number",
  "Suborder Number",
  "Invoice Number",
  "Order Date",
  "OMS SKU",
  "SKU",
  "Listing ID",
  "Quantity",
  "Awb Number",
];

const normalizeHeader = (header: string) => header.replace(/[\s_]+/g, "").toLowerCase();

/** One sheet per status tab, each holding exactly the rows that tab shows. */
const exportBatchXlsx = (batch: ScanPackBatch) => {
  // Uploaded sheets vary in casing and spacing ("AWB number", "Listing_ID"), so
  // each export column is resolved to whatever the sheet actually called it.
  const sourceHeaders = EXPORT_SHEET_COLUMNS.map((column) =>
    batch.headers.find((header) => normalizeHeader(header) === normalizeHeader(column))
  );
  // The sheet's own Shipping Label / Invoice columns are placeholders; the
  // export reports whether that part is actually mapped.
  const columns = [...EXPORT_SHEET_COLUMNS, "Shipping Label", "Invoice"];
  const ordered = batch.orders.slice().sort((a, b) => a.rowIndex - b.rowIndex);

  const workbook = XLSX.utils.book_new();
  for (const tab of STATUS_TABS) {
    const data = ordered
      .filter((order) => matchesStatus(order, tab.key))
      .map((order) => [
        ...sourceHeaders.map((header) => (header ? order.raw[header] ?? "" : "")),
        order.mapping?.labelPages.length ? "Yes" : "No",
        order.mapping?.invoicePages.length ? "Yes" : "No",
      ]);
    const sheet = XLSX.utils.aoa_to_sheet([columns, ...data]);
    sheet["!cols"] = columns.map((column) => ({ wch: Math.max(14, column.length + 2) }));
    XLSX.utils.book_append_sheet(workbook, sheet, tab.label);
  }
  XLSX.writeFile(workbook, `${batch.batchId}.xlsx`);
};

const ScanAndPackBatch = () => {
  const { batchId = "" } = useParams();
  const navigate = useNavigate();

  const [batch, setBatch] = useState<ScanPackBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [bulkOpen, setBulkOpen] = useState(false);
  // PDF preview modal state — opened by the inline eye icons on the Label /
  // Invoice cells. `bytes: null` means the pdf-lib pass is still running.
  const [preview, setPreview] = useState<{
    title: string;
    subtitle?: string;
    bytes: Uint8Array | null;
  } | null>(null);
  /** Order id currently being reprinted, so only that row shows a spinner. */
  const [reprintingId, setReprintingId] = useState<string | null>(null);
  /** Set when a reprint was refused because Print Target ≠ the packlog's scan mode. */
  const [mismatch, setMismatch] = useState<PrintTargetMismatch | null>(null);
  const [printerOpen, setPrinterOpen] = useState(false);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await PacklogService.getPacklog(decodeURIComponent(batchId));
      if (!aliveRef.current) return;
      // Two-level unwrap: axios → BE envelope → payload.
      const envelope = (
        response as unknown as { data?: { data?: { packlog: unknown; orders: unknown[] } } }
      )?.data?.data;
      if (!envelope?.packlog) {
        toast.error("This packlog no longer exists.");
        navigate(ROUTE_URLS.SCAN_AND_PACK, { replace: true });
        return;
      }
       
      setBatch(adaptPacklogDetail(envelope as any));
    } catch (error) {
      if (aliveRef.current) {
        toast.error(error instanceof Error ? error.message : "Could not load this packlog.");
      }
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [batchId, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!batch) return [];
    const needle = search.trim().toLowerCase();
    return batch.orders
      .filter((order) => {
        if (!matchesStatus(order, status)) return false;
        if (!needle) return true;
        // Search across every sheet column so an operator can look up a row by
        // SKU or listing id, not only by AWB.
        return Object.values(order.raw).some((value) => value.toLowerCase().includes(needle));
      })
      // Packed first, most recently packed at the very top, so a parcel that
      // just came off the printer appears where the packer is already looking.
      // Ties and the whole Ready-to-pack block keep the original sheet order,
      // which is the sequence the picker walks the shelves in.
      .slice()
      .sort((a, b) => {
        const aPacked = a.packStatus === "packed";
        const bPacked = b.packStatus === "packed";
        if (aPacked !== bPacked) return aPacked ? -1 : 1;
        if (aPacked && bPacked) {
          const at = a.packedAt ? Date.parse(a.packedAt) : 0;
          const bt = b.packedAt ? Date.parse(b.packedAt) : 0;
          if (at !== bt) return bt - at;
        }
        return a.rowIndex - b.rowIndex;
      })
      .map((order) => ({
        // `raw` is spread first so a sheet column literally named "id" cannot
        // clobber the DataGrid row identity.
        ...order.raw,
        id: order.id,
        [MAPPED_FIELD]: Boolean(order.mapping),
        // Real page counts from the scan — not the sheet placeholder columns.
        [LABEL_COUNT_FIELD]: order.mapping?.labelPages.length ?? 0,
        [INVOICE_COUNT_FIELD]: order.mapping?.invoicePages.length ?? 0,
        [PACK_STATUS_FIELD]: order.packStatus,
        [PACKED_AT_FIELD]: order.packedAt,
      }));
  }, [batch, search, status]);

  // Reset to the first page whenever the visible set changes, otherwise a
  // filter that shrinks the result set leaves the grid stranded on an empty page.
  useEffect(() => {
    setPage(1);
  }, [search, status]);

  const pagedRows = useMemo(() => rows.slice((page - 1) * limit, page * limit), [rows, page, limit]);

  /**
   * Reprint an already-packed parcel straight from the table, using the same
   * printer assignment and target the pack page uses (Printer Setup, stored
   * per machine). Deliberately does NOT touch pack status: the parcel was
   * packed when it was first printed, and `packedAt` drives the ordering
   * above — bumping it on every reprint would shuffle the grid under the
   * operator's hands.
   */
  const handleReprint = useCallback(
    async (orderId: string) => {
      if (!batch) return;
      const order = batch.orders.find((o) => o.id === orderId);
      if (!order) return;

      // Same rule as the pack page: Print Target must equal the scan mode.
      const target = readStoredTarget();
      const blocked = findPrintTargetMismatch(target, batch.scanMode);
      if (blocked) {
        setMismatch(blocked);
        return;
      }
      const part = target;
      const ready =
        part === "label"
          ? Boolean(order.mapping?.labelPages.length)
          : part === "invoice"
          ? Boolean(order.mapping?.invoicePages.length)
          : Boolean(order.mapping?.labelPages.length && order.mapping?.invoicePages.length);
      if (!ready) {
        toast.error(`${order.awbRaw || order.awb} has no ${part} mapped — nothing to reprint.`);
        return;
      }

      setReprintingId(orderId);
      try {
        const outcome = await dispatchPrint(batch.id, order, part);
        if (aliveRef.current) {
          if (outcome.viaAgent) {
            toast.success(readOutputMode() === "download" ? outcome.message : `Reprinted ${order.awbRaw || order.awb}.`);
          }
          else toast(outcome.message, { duration: 6000 });
        }
      } catch (err) {
        if (aliveRef.current) {
          toast.error(err instanceof Error ? err.message : "Could not reprint that order.");
        }
      } finally {
        if (aliveRef.current) setReprintingId(null);
      }
    },
    [batch]
  );

  const columns: GridColDef[] = useMemo(() => {
    if (!batch) return [];
    const sheetColumns: GridColDef[] = batch.headers
      .filter(isVisibleHeader)
      .map((header) => ({
        field: header,
        headerName: header,
        flex: 1,
        minWidth: 140,
        resizable: true,
        renderCell: (params) => (
          <Typography
            sx={{ fontSize: 12, color: params.value ? "text.primary" : "text.disabled" }}
            title={params.value || ""}
          >
            {params.value || "—"}
          </Typography>
        ),
      }));

    const mappedHeader =
      batch.scanMode === "label"
        ? "Label Mapped"
        : batch.scanMode === "invoice"
        ? "Invoice Mapped"
        : "Label/Invoice Mapped";

    // Per-cell count + inline view icon. Cells with a mapping show the page
    // count and a small eye that opens the PDF preview modal for that part;
    // cells with no mapping show a dim "—" and no eye.
    const makeCountRenderer =
      (part: "label" | "invoice") => (params: { value?: unknown; id: unknown }) => {
        const count = Number(params.value) || 0;
        const disabled = count === 0;
        const partLabel = part === "label" ? "Shipping Label" : "Invoice";
        if (disabled) {
          return (
            <Typography sx={{ fontSize: 12, color: "text.disabled" }}>—</Typography>
          );
        }
        return (
          <IconButton
            size="small"
            title={`${count} page${count === 1 ? "" : "s"}`}
            onClick={async (event) => {
              event.stopPropagation();
              const orderId = String(params.id);
              const order = batch.orders.find((o) => o.id === orderId);
              if (!order) return;
              const awb = order.awbRaw || order.awb || orderId;
              setPreview({ title: `${partLabel} · ${awb}`, subtitle: `Packlog ${batch.batchId}`, bytes: null });
              try {
                const arrayBuffer = await PacklogService.downloadPart(batch.id, orderId, part);
                const bytes = new Uint8Array(arrayBuffer);
                setPreview({ title: `${partLabel} · ${awb}`, subtitle: `Packlog ${batch.batchId}`, bytes });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not fetch the PDF preview.");
                setPreview(null);
              }
            }}
            sx={{
              padding: "4px",
              borderRadius: "6px",
              color: "primary.main",
              "&:hover": { backgroundColor: "rgba(0,136,163,0.10)" },
            }}
            aria-label={`Preview ${partLabel}`}
          >
            <VisibilityOutlined sx={{ width: 16, height: 16 }} />
          </IconButton>
        );
      };

    const showLabelCol = batch.scanMode !== "invoice";
    const showInvoiceCol = batch.scanMode !== "label";

    const partColumns: GridColDef[] = [];
    if (showLabelCol) {
      partColumns.push({
        field: LABEL_COUNT_FIELD,
        headerName: "Shipping Label",
        width: 170,
        resizable: false,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: makeCountRenderer("label"),
      });
    }
    if (showInvoiceCol) {
      partColumns.push({
        field: INVOICE_COUNT_FIELD,
        headerName: "Invoice",
        width: 170,
        resizable: false,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: makeCountRenderer("invoice"),
      });
    }

    return [
      ...sheetColumns,
      ...partColumns,
      {
        field: MAPPED_FIELD,
        headerName: mappedHeader,
        width: 180,
        resizable: false,
        renderCell: (params) => (
          <Chip
            size="small"
            label={params.value ? "Yes" : "No"}
            sx={{
              height: 22,
              minWidth: 48,
              borderRadius: "6px",
              fontSize: 11,
              fontWeight: 600,
              bgcolor: params.value ? "rgba(22,163,74,0.12)" : "rgba(220,38,38,0.12)",
              color: params.value ? "#15803D" : "#B91C1C",
            }}
          />
        ),
      },
      {
        field: PACK_STATUS_FIELD,
        headerName: "Pack Status",
        width: 160,
        resizable: false,
        renderCell: (params) => (
          <PackStatusChip
            status={params.value as PackStatus}
            packedAt={params.row[PACKED_AT_FIELD] as string | null}
          />
        ),
      },
      {
        field: ACTIONS_FIELD,
        headerName: "Action",
        width: 130,
        resizable: false,
        sortable: false,
        align: "center",
        headerAlign: "center",
        // Reprint only exists for a parcel that already went out — there is
        // nothing to "re"print otherwise, and the pack page is the right place
        // to print something the first time.
        renderCell: (params) =>
          params.row[PACK_STATUS_FIELD] === "packed" ? (
            <ReprintButton
              busy={reprintingId === params.row.id}
              disabled={reprintingId !== null}
              onClick={() => void handleReprint(String(params.row.id))}
            />
          ) : null,
      },
    ];
  }, [batch, handleReprint, reprintingId]);

  if (loading && !batch) {
    return (
      <Page title="Scan and Pack">
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
          <CircularProgress size={28} />
        </Box>
      </Page>
    );
  }

  if (!batch) return null;

  const mapped = countMapped(batch.orders);
  const unmapped = batch.orders.length - mapped;
  const packed = batch.orders.filter((order) => order.packStatus === "packed").length;
  const ready = batch.orders.length - packed;

  return (
    <Page title={`Packlog — ${batch.batchId}`}>
      <Stack spacing={1.5} sx={{ mb: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1.5}>
          <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
            <ButtonElement
              type="button"
              variant="outlined"
              size="small"
              onClick={() => navigate(ROUTE_URLS.SCAN_AND_PACK)}
              startIcon={<ArrowBack sx={{ fontSize: 14 }} />}
              sx={{
                color: "text.primary",
                textTransform: "none",
                fontSize: 12.5,
                fontWeight: 500,
                height: 32,
                px: 1.5,
                minWidth: "auto",
                "& .MuiButton-startIcon": { mr: 0.5 },
              }}
            >
              Back
            </ButtonElement>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                sx={{ fontSize: "1.125rem", fontWeight: 700, color: "text.primary", lineHeight: 1.2 }}
              >
                {batch.batchId}
              </Typography>
              <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                {getPlatform(batch.platform)?.label ?? batch.platform} ·{" "}
                {format(new Date(batch.createdAt), "dd/MM/yyyy hh:mm a")} · {batch.orderFileName}
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <ButtonElement
              type="button"
              variant="outlined"
              size="small"
              onClick={() => {
                try {
                  exportBatchXlsx(batch);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not export this packlog.");
                }
              }}
              disabled={batch.orders.length === 0}
              startIcon={<FileDownloadOutlined sx={{ fontSize: 14 }} />}
              sx={{
                color: "primary.main",
                textTransform: "none",
                fontSize: 12.5,
                fontWeight: 600,
                height: 32,
                px: 1.75,
                whiteSpace: "nowrap",
                "& .MuiButton-startIcon": { mr: 0.5 },
              }}
            >
              Export
            </ButtonElement>
            <ButtonElement
              type="button"
              variant="outlined"
              size="small"
              onClick={() => setBulkOpen(true)}
              startIcon={<PublishedWithChangesOutlined sx={{ fontSize: 14 }} />}
              sx={{
                color: "primary.main",
                textTransform: "none",
                fontSize: 12.5,
                fontWeight: 600,
                height: 32,
                px: 1.75,
                whiteSpace: "nowrap",
                "& .MuiButton-startIcon": { mr: 0.5 },
              }}
            >
              Bulk Update
            </ButtonElement>
            <ButtonElement
              type="button"
              variant="contained"
              size="small"
              onClick={() => navigate(`${ROUTE_URLS.SCAN_AND_PACK}/${encodeURIComponent(batch.id)}/pack`)}
              disabled={mapped === 0}
              startIcon={<QrCodeScannerOutlined sx={{ fontSize: 14 }} />}
              sx={{
                color: "white",
                textTransform: "none",
                fontSize: 12.5,
                fontWeight: 600,
                height: 32,
                px: 1.75,
                whiteSpace: "nowrap",
                "& .MuiButton-startIcon": { mr: 0.5 },
              }}
            >
              Scan And Pack
            </ButtonElement>
          </Stack>
        </Stack>

        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1.25}>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            {STATUS_TABS.map((tab) => {
              const count = {
                all: batch.orders.length,
                mapped,
                unmapped,
                ready,
                packed,
              }[tab.key];
              const active = status === tab.key;
              return (
                <Box
                  key={tab.key}
                  onClick={() => setStatus(tab.key)}
                  sx={(t) => ({
                    height: 32,
                    px: 1.5,
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    cursor: "pointer",
                    borderRadius: "6px",
                    border: `1px solid ${active ? t.palette.primary.main : t.palette.divider}`,
                    bgcolor: active ? "rgba(0,136,163,0.08)" : "transparent",
                    color: active ? "primary.main" : "text.secondary",
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                  })}
                >
                  {tab.label}
                  <Chip
                    size="small"
                    label={count}
                    sx={{
                      height: 18,
                      borderRadius: "6px",
                      fontSize: 10.5,
                      fontWeight: 600,
                      bgcolor: active ? "rgba(0,136,163,0.16)" : "rgba(0,0,0,0.06)",
                      color: "inherit",
                    }}
                  />
                </Box>
              );
            })}
          </Stack>

          <Box sx={{ width: { xs: "100%", sm: 280 } }}>
            <TextInput
              name="order-search"
              placeholder="Search orders..."
              type="search"
              size="small"
              fullWidth
              value={search}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.currentTarget.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search sx={{ fontSize: 18, color: "text.secondary" }} />
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        </Stack>
      </Stack>

      <DataTable
        columns={columns}
        rows={pagedRows}
        page={page}
        limit={limit}
        setPage={setPage}
        setLimit={setLimit}
        totalRow={rows.length}
        rowHeight={36}
        isLoading={loading}
        height={{
          xs: "calc((100vh - 300px) / 0.95)",
          sm: "calc((100vh - 300px) / 0.95)",
          md: "calc((100vh - 290px) / 0.95)",
          lg: "calc((100vh - 270px) / 0.95)",
          xl: "calc((100vh - 270px) / 0.95)",
        }}
      />

      <PrintTargetMismatchDialog
        mismatch={mismatch}
        onClose={() => setMismatch(null)}
        onChangeSettings={() => {
          setMismatch(null);
          setPrinterOpen(true);
        }}
      />
      {printerOpen && (
        <PrinterSetupModal open={printerOpen} onClose={() => setPrinterOpen(false)} />
      )}

      {bulkOpen && (
        <BulkUpdateModal
          open={bulkOpen}
          batch={batch}
          onClose={() => setBulkOpen(false)}
          // Refetch rather than patch local state: the mapping now lives on
          // the server, and trusting the modal's in-memory copy would paint
          // rows as Mapped even where the upload failed.
          onUpdated={() => {
            setBulkOpen(false);
            void load();
          }}
        />
      )}

      <PdfPreviewModal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.title ?? ""}
        subtitle={preview?.subtitle}
        bytes={preview?.bytes ?? null}
      />

    </Page>
  );
};

export default ScanAndPackBatch;
