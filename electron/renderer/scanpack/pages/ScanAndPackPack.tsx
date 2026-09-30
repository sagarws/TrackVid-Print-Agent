/**
 * Scan-and-Pack packing page.
 *
 * Route: /scan-and-pack/:batchId/pack/:orderId?
 *
 * Full-screen replacement for the old ScanAndPackModal. Behaves the same way
 * (scan an AWB / Listing SKU / Listing ID → preview → print/download), but
 * lives at its own URL so navigation, Back, and the Printers action are all
 * first-class rather than nested inside a dialog. If an `orderId` is present in
 * the URL, the matching order is auto-selected on load — this is what the
 * batch-detail "View" action and row-click navigate to.
 */
import {
  Alert,
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  ArrowBack,
  DownloadOutlined,
  PrintOutlined,
  QrCodeScannerOutlined,
} from "@mui/icons-material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import type { GridColDef } from "@mui/x-data-grid";
import { Page } from "./Page";
import DataTable from "../components/common/DataTable";
import ButtonElement from "../components/common/Button";
import { PackStatusChip, ReprintButton } from "../components/ScanAndPack/PackStatusCells";
import PrinterSetupModal from "../components/ScanAndPack/PrinterSetupModal";
import { PacklogService, adaptPacklogDetail } from "../api/packlog-service";
import { downloadPdf, type PrintPart } from "../utils/scan-and-pack/pdf-output";
import {
  dispatchPrint,
  readOutputMode,
  fetchOrderBytes,
  findPrintTargetMismatch,
  readStoredTarget,
  type PrintTargetMismatch,
} from "../utils/scan-and-pack/print-dispatch";
import PrintTargetMismatchDialog from "../components/ScanAndPack/PrintTargetMismatchDialog";
import useBarcodeScanner from "../components/hooks/useBarcodeScanner";
import { normaliseAwb } from "../utils/scan-and-pack/platforms";
import { findHeader } from "../utils/scan-and-pack/sheet";
import ROUTE_URLS from "../config/route";
import type { PackStatus, ScanPackBatch, ScanPackOrder } from "../types/scanAndPack.types";
import { LOCALSTORAGE_SCANPACK_COPY_AWB_ON_PRINT, SCANPACK_PART_LABELS } from "../config/constant";

type Action = `${"print" | "download"}:${PrintPart}`;

/**
 * How long the field sits still before it prints itself.
 *
 * The operator should never have to press Enter. Most scanners send one, and
 * that path still fires instantly — but plenty are configured without a
 * suffix, and typing a number by hand has no natural "done" either. So a
 * quiet field is the commit signal.
 *
 * 2s is chosen to sit well clear of both ends: a scanner delivers its whole
 * payload in ~100ms, so it never trips mid-code, and it still leaves room to
 * correct a typo before the label goes out.
 */
const AUTO_COMMIT_MS = 2000;

/**
 * Don't auto-fire on a stray keypress. Every AWB, SKU and listing id in this
 * module is far longer than this; the floor only exists so brushing the
 * keyboard cannot send a parcel to the printer.
 */
const MIN_AUTO_COMMIT_LENGTH = 4;

const ScanAndPackPack = () => {
  const { batchId = "", orderId = "" } = useParams();
  const navigate = useNavigate();

  const [batch, setBatch] = useState<ScanPackBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [awbInput, setAwbInput] = useState("");
  const [selected, setSelected] = useState<ScanPackOrder | null>(null);
  const [runningAction, setRunningAction] = useState<Action | null>(null);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [printTarget, setPrintTarget] = useState<PrintPart>(readStoredTarget);
  /** Set when a print was refused because Print Target ≠ the packlog's scan mode. */
  const [mismatch, setMismatch] = useState<PrintTargetMismatch | null>(null);
  const [copyAwb, setCopyAwb] = useState<boolean>(
    () => localStorage.getItem(LOCALSTORAGE_SCANPACK_COPY_AWB_ON_PRINT) === "1"
  );
  const [packPage, setPackPage] = useState(1);
  const [packLimit, setPackLimit] = useState(10);
  /** Order id currently being reprinted, so only that row shows a spinner. */
  const [reprintingId, setReprintingId] = useState<string | null>(null);

  // The Print Target radio lives inside the Printer Setup modal now. When the
  // modal closes, refresh from localStorage so a change there is immediately
  // reflected in the pack card's action buttons.
  useEffect(() => {
    if (!printerOpen) setPrintTarget(readStoredTarget());
  }, [printerOpen]);

  const handleCopyAwbChange = (checked: boolean) => {
    setCopyAwb(checked);
    if (checked) localStorage.setItem(LOCALSTORAGE_SCANPACK_COPY_AWB_ON_PRINT, "1");
    else localStorage.removeItem(LOCALSTORAGE_SCANPACK_COPY_AWB_ON_PRINT);
  };

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
        toast.error("This packlog is no longer available.");
        navigate(ROUTE_URLS.SCAN_AND_PACK);
        return;
      }
       
      setBatch(adaptPacklogDetail(envelope as any));
    } catch (err) {
      if (aliveRef.current) {
        toast.error(err instanceof Error ? err.message : "Could not load this packlog.");
      }
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [batchId, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  const options = useMemo(
    () => (batch ? batch.orders.filter((order) => order.mapping && order.awb) : []),
    [batch]
  );

  const listingSkuHeader = useMemo(
    () => (batch ? findHeader(batch.headers, ["listing sku", "listing skus"]) : null),
    [batch]
  );
  const listingIdHeader = useMemo(
    () => (batch ? findHeader(batch.headers, ["listing id", "listing ids"]) : null),
    [batch]
  );

  // If the URL carried an orderId, auto-select the matching order once the
  // batch resolves. Prefer mapped options; fall back to any order in the batch
  // so an operator following a "View" link on an unmapped row still lands on
  // something informative even if they can't print yet.
  useEffect(() => {
    if (!batch || !orderId) return;
    const decoded = decodeURIComponent(orderId);
    const match =
      options.find((o) => o.id === decoded) ??
      batch.orders.find((o) => o.id === decoded) ??
      null;
    setSelected(match);
    if (!match) toast.error("That order could not be found in this packlog.");
  }, [batch, orderId, options]);

  const matchesColumn = (order: ScanPackOrder, header: string, needle: string) =>
    normaliseAwb(order.raw[header] ?? "") === needle;

  /**
   * Resolve a typed or scanned string to an order and select it.
   *
   * Returns the matched order so a scan can print it immediately — reading it
   * back out of `selected` would race, since that setState has not committed
   * by the time the handler continues.
   */
  const resolveTyped = (value: string): ScanPackOrder | null => {
    if (!batch) return null;
    const needle = normaliseAwb(value);
    if (!needle) return null;

    const awbHit = options.find((order) => order.awb === needle);
    if (awbHit) {
      setSelected(awbHit);
      return awbHit;
    }

    let columnHit: ScanPackOrder | null = null;
    const tryColumn = (header: string | null, label: string): boolean => {
      if (!header) return false;
      const hits = options.filter((order) => matchesColumn(order, header, needle));
      const [hit] = hits;
      if (hits.length === 1 && hit) {
        setSelected(hit);
        columnHit = hit;
        return true;
      }
      if (hits.length > 1) {
        toast.error(`"${value}" matches ${hits.length} mapped orders by ${label} — scan the AWB to disambiguate.`);
        return true;
      }
      return false;
    };
    if (tryColumn(listingSkuHeader, "Listing SKU")) return columnHit;
    if (tryColumn(listingIdHeader, "Listing ID")) return columnHit;

    const anyMatch = batch.orders.find(
      (order) =>
        order.awb === needle ||
        (listingSkuHeader && matchesColumn(order, listingSkuHeader, needle)) ||
        (listingIdHeader && matchesColumn(order, listingIdHeader, needle))
    );
    toast.error(
      anyMatch
        ? `"${value}" is in this packlog but has no label mapped yet.`
        : `Nothing in packlog ${batch.batchId} matches "${value}".`
    );
    return null;
  };

  /**
   * Flip one order to Packed, once. Called after the first successful print,
   * whether that print came from a scan or from the manual button.
   *
   * The grid updates optimistically so the operator sees the chip turn over
   * the instant the paper goes out; if the PATCH then fails we roll the row
   * back and say so, because a row silently stuck on "Ready to pack" would
   * get picked up and packed a second time.
   */
  const markOrderPacked = useCallback(
    async (order: ScanPackOrder) => {
      if (!batch || order.packStatus === "packed") return;
      const packedAt = new Date().toISOString();
      const apply = (status: ScanPackOrder["packStatus"], at: string | null) =>
        setBatch((prev) =>
          prev
            ? {
                ...prev,
                orders: prev.orders.map((o) =>
                  o.id === order.id ? { ...o, packStatus: status, packedAt: at } : o
                ),
              }
            : prev
        );

      apply("packed", packedAt);
      try {
        await PacklogService.markPacked(batch.id, order.id);
      } catch (err) {
        if (!aliveRef.current) return;
        apply("ready", null);
        toast.error(
          err instanceof Error
            ? `Printed, but could not mark packed: ${err.message}`
            : "Printed, but could not mark this order packed."
        );
      }
    },
    [batch]
  );

  /**
   * If the packer opted in via Printer Setup, copy the current order's AWB to
   * the clipboard every time they hit Print. This is the workflow the legacy
   * pack tool trained operators on — the AWB lands in the clipboard so the
   * next paste (into the marketplace's "mark packed" panel) is a single Cmd/
   * Ctrl+V. Silent failure: clipboard access can be denied without user
   * gesture on some browsers, and refusing to print because of that would be
   * worse than skipping the convenience.
   */
  const maybeCopyAwbOnPrint = async (order: ScanPackOrder) => {
    if (localStorage.getItem(LOCALSTORAGE_SCANPACK_COPY_AWB_ON_PRINT) !== "1") return;
    const awb = order.awbRaw || order.awb;
    if (!awb) return;
    try {
      await navigator.clipboard.writeText(awb);
      toast.success(`Copied AWB: ${awb}`);
    } catch (err) {
      console.warn("[scan-and-pack] copy AWB to clipboard failed", err);
    }
  };

  /**
   * The browser print dialog gives us nothing back — `window.print()` returns
   * the moment the dialog opens, and `afterprint` fires identically whether
   * the operator pressed Print or Cancel. So on that path we genuinely do not
   * know if paper came out, and marking the parcel Packed would be a guess.
   * Leaving it Ready to pack is the safe error: the parcel gets looked at
   * again, rather than silently shipping unlabelled.
   */
  const warnUnconfirmedPrint = (message: string) =>
    toast(
      `${message} Left as Ready to pack because the print can't be confirmed — packing is automatic only when the TrackVid Print Agent prints it.`,
      { duration: 6000 }
    );

  const run = async (action: Action) => {
    if (!selected || !batch) return;
    const [mode, part] = action.split(":") as ["print" | "download", PrintPart];
    const blocked = findPrintTargetMismatch(part, batch.scanMode);
    if (blocked) {
      setMismatch(blocked);
      return;
    }
    setRunningAction(action);
    try {
      if (mode === "print") {
        await maybeCopyAwbOnPrint(selected);
        const outcome = await dispatchPrint(batch.id, selected, part);
        // Only a print packs a parcel, and only one we can actually confirm.
        // Download is a "give me the file" action and never packs anything.
        if (outcome.viaAgent) {
          toast.success(outcome.message);
          await markOrderPacked(selected);
        } else {
          warnUnconfirmedPrint(outcome.message);
        }
      } else {
        const bytes = await fetchOrderBytes(batch.id, selected, part);
        downloadPdf(bytes, `${selected.awb || selected.id}-${part}.pdf`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not prepare the PDF.");
    } finally {
      setRunningAction(null);
    }
  };

  /**
   * A number was committed — scanned into the field, scanned while focus was
   * elsewhere, or typed and Entered. Resolve it, print it on the spot using
   * the operator's Printer Setup, and pack it. There is no manual Print step
   * in this flow: the number arriving IS the instruction to print.
   *
   * `scanBusyRef` serialises the bursts: a packer can scan the next parcel
   * while the previous PDF is still downloading, and two concurrent jobs would
   * interleave on the printer. Dropping the second scan with a warning is
   * better than printing it out of order — the operator simply rescans.
   */
  const scanBusyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const commitAndPrint = useCallback(
    async (rawValue: string) => {
      const value = rawValue.trim();
      if (!value || !batch) return;

      // Clear immediately, before any await. A scanner types straight into
      // this field, so anything left behind would have the next barcode
      // appended to it and resolve to the wrong parcel.
      setAwbInput("");
      inputRef.current?.focus();

      if (scanBusyRef.current) {
        toast("Still printing the last scan — rescan this parcel in a moment.");
        return;
      }

      const order = resolveTyped(value);
      // resolveTyped has already explained the miss to the operator.
      if (!order) return;

      // Checked before touching the order: a wrong Print Target would print
      // the wrong document for every parcel, not just this one.
      const blocked = findPrintTargetMismatch(printTarget, batch.scanMode);
      if (blocked) {
        setMismatch(blocked);
        return;
      }
      const part = printTarget;
      const partReady =
        part === "label"
          ? Boolean(order.mapping?.labelPages.length)
          : part === "invoice"
          ? Boolean(order.mapping?.invoicePages.length)
          : Boolean(order.mapping?.labelPages.length && order.mapping?.invoicePages.length);
      if (!partReady) {
        toast.error(`${order.awbRaw || order.awb} has no ${part} mapped — nothing to print.`);
        return;
      }

      scanBusyRef.current = true;
      setRunningAction(`print:${part}`);
      try {
        await maybeCopyAwbOnPrint(order);
        const outcome = await dispatchPrint(batch.id, order, part);
        if (!aliveRef.current) return;
        const wasPacked = order.packStatus === "packed";
        if (outcome.viaAgent) {
          // Auto Download saves again rather than reprinting; say what happened.
          toast.success(
            wasPacked && readOutputMode() !== "download" ? `Reprinted ${order.awbRaw || order.awb}.` : outcome.message
          );
          await markOrderPacked(order);
        } else {
          warnUnconfirmedPrint(outcome.message);
        }
      } catch (err) {
        if (aliveRef.current) {
          toast.error(err instanceof Error ? err.message : "Could not print that scan.");
        }
      } finally {
        scanBusyRef.current = false;
        if (aliveRef.current) setRunningAction(null);
      }
    },
    // `resolveTyped` and `maybeCopyAwbOnPrint` close over `batch`/`options`,
    // which are already in the dependency list through `batch` and `printTarget`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batch, printTarget, markOrderPacked]
  );

  // Catches a scan made while focus is somewhere else on the page — after
  // clicking Printers, say. When the field itself has focus the scanner's
  // characters land in it and its own Enter handler commits, so the hook
  // deliberately ignores events coming from a field and the parcel is never
  // printed twice.
  useBarcodeScanner({
    onScan: commitAndPrint,
    enabled: Boolean(batch) && !printerOpen && !mismatch,
  });

  /**
   * Commit the field once it has been quiet for `AUTO_COMMIT_MS`, so Enter is
   * never required. Every keystroke replaces the pending timer, so the clock
   * only starts when the operator (or the scanner) has actually stopped.
   *
   * `commitAndPrint` empties the field as its first act, which re-runs this
   * effect with an empty value and schedules nothing — that is what stops a
   * printed parcel from firing again two seconds later.
   */
  useEffect(() => {
    if (!batch || printerOpen || mismatch) return;
    const value = awbInput.trim();
    if (value.length < MIN_AUTO_COMMIT_LENGTH) return;

    const timer = window.setTimeout(() => void commitAndPrint(value), AUTO_COMMIT_MS);
    return () => window.clearTimeout(timer);
  }, [awbInput, batch, printerOpen, mismatch, commitAndPrint]);

  const hasLabel = Boolean(selected?.mapping?.labelPages.length);
  const hasInvoice = Boolean(selected?.mapping?.invoicePages.length);
  // Shown above the scan field so the operator sees the problem before the
  // first scan, not only in the modal after it.
  const currentMismatch = batch ? findPrintTargetMismatch(printTarget, batch.scanMode) : null;

  // Enable the action buttons only when the selected order actually carries
  // the chosen part. "Both" needs both sides mapped.
  const selectedTargetReady =
    printTarget === "label"
      ? hasLabel
      : printTarget === "invoice"
      ? hasInvoice
      : hasLabel && hasInvoice;
  const printLabel =
    printTarget === "label"
      ? "Print Label"
      : printTarget === "invoice"
      ? "Print Invoice"
      : "Print Both";
  const downloadLabel =
    printTarget === "label"
      ? "Download Label PDF"
      : printTarget === "invoice"
      ? "Download Invoice PDF"
      : "Download Both PDF";

  // The field is holding something long enough to print and no job is in
  // flight — i.e. the 2s clock is running.
  const autoCommitPending =
    awbInput.trim().length >= MIN_AUTO_COMMIT_LENGTH && runningAction === null;

  // ---------------------------------------------------------------------
  // Live packlog table
  //
  // Reads the same `batch` state the pack flow mutates, so a scan repaints
  // it with no refetch: the row flips to Packed and jumps to the top while
  // the operator is still holding the parcel.
  // ---------------------------------------------------------------------

  const packRows = useMemo(() => {
    if (!batch) return [];
    return batch.orders
      .slice()
      // Same ordering as the packlog table: packed first, newest packed on
      // top, everything else in sheet order (the order the shelves are
      // walked in).
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
        id: order.id,
        awb: order.awbRaw || order.awb,
        sku: listingSkuHeader ? order.raw[listingSkuHeader] ?? "" : "",
        listingId: listingIdHeader ? order.raw[listingIdHeader] ?? "" : "",
        mapped: Boolean(order.mapping),
        packStatus: order.packStatus,
        packedAt: order.packedAt,
      }));
  }, [batch, listingSkuHeader, listingIdHeader]);

  const pagedPackRows = useMemo(
    () => packRows.slice((packPage - 1) * packLimit, packPage * packLimit),
    [packRows, packPage, packLimit]
  );

  /**
   * Reprint from the table. Same printer settings as a scan, and it never
   * touches pack status — `packedAt` drives the ordering above, so bumping it
   * would move the row out from under the click that started it.
   */
  const handleReprint = useCallback(
    async (rowId: string) => {
      if (!batch) return;
      const order = batch.orders.find((o) => o.id === rowId);
      if (!order) return;

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

      setReprintingId(rowId);
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

  const packColumns: GridColDef[] = useMemo(
    () => [
      {
        field: "awb",
        headerName: "Forward AWB",
        flex: 1,
        minWidth: 170,
        renderCell: (params) => (
          <Typography
            sx={{ fontSize: 12.5, fontWeight: 600, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          >
            {params.value || "—"}
          </Typography>
        ),
      },
      ...(listingSkuHeader
        ? [{ field: "sku", headerName: "Listing SKU", flex: 1, minWidth: 150 } as GridColDef]
        : []),
      ...(listingIdHeader
        ? [{ field: "listingId", headerName: "Listing ID", flex: 1, minWidth: 150 } as GridColDef]
        : []),
      {
        field: "mapped",
        headerName: "Mapped",
        width: 110,
        sortable: false,
        renderCell: (params) => (
          <Chip
            size="small"
            label={params.value ? "Yes" : "No"}
            sx={{
              height: 22,
              minWidth: 44,
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
        field: "packStatus",
        headerName: "Pack Status",
        width: 150,
        renderCell: (params) => (
          <PackStatusChip
            status={params.value as PackStatus}
            packedAt={params.row.packedAt as string | null}
          />
        ),
      },
      {
        field: "__action__",
        headerName: "Action",
        width: 130,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params) =>
          params.row.packStatus === "packed" ? (
            <ReprintButton
              busy={reprintingId === params.row.id}
              disabled={reprintingId !== null || runningAction !== null}
              onClick={() => void handleReprint(String(params.row.id))}
            />
          ) : null,
      },
    ],
    [listingSkuHeader, listingIdHeader, reprintingId, runningAction, handleReprint]
  );

  const secondaryFields: { label: string; header: string }[] = [
    ...(listingSkuHeader ? [{ label: "SKU", header: listingSkuHeader }] : []),
    ...(listingIdHeader ? [{ label: "ID", header: listingIdHeader }] : []),
  ];
  const lookupLabel = ["AWB", ...secondaryFields.map((f) => f.label)].join(" / ");

  const actionButton = (
    action: Action,
    label: string,
    icon: React.ReactNode,
    disabled = false
  ) => (
    <ButtonElement
      type="button"
      variant={action.startsWith("print") ? "contained" : "outlined"}
      size="small"
      loading={runningAction === action}
      disabled={Boolean(runningAction) || disabled}
      onClick={() => run(action)}
      startIcon={icon}
      sx={{
        textTransform: "none",
        fontSize: 12.5,
        fontWeight: 600,
        // Fixed height and no wrapping: these used to be `flex: 1 1 100px`,
        // and at that basis "Download Label PDF" broke onto a second line and
        // doubled the button's height next to a single-line one. Sizing to
        // content instead keeps both at normal button height.
        height: 34,
        whiteSpace: "nowrap",
        flex: "0 0 auto",
        minWidth: 148,
        px: 2,
        ...(action.startsWith("print") ? { color: "white" } : { color: "primary.main" }),
        "& .MuiButton-startIcon": { mr: 0.5, "& > svg": { fontSize: 14 } },
      }}
    >
      {label}
    </ButtonElement>
  );

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

  return (
    <Page title={`Pack — ${batch.batchId}`}>
      {/* Toolbar row: Back, title, Printers action. */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        gap={1.25}
        sx={{ mb: 2 }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0, flex: 1 }}>
          <ButtonElement
            type="button"
            variant="outlined"
            size="small"
            onClick={() => navigate(`${ROUTE_URLS.SCAN_AND_PACK}/${encodeURIComponent(batch.id)}`)}
            startIcon={<ArrowBack sx={{ fontSize: 16 }} />}
            sx={{
              color: "text.primary",
              textTransform: "none",
              fontSize: 12.5,
              fontWeight: 500,
              height: 32,
              px: 1.75,
              whiteSpace: "nowrap",
              "& .MuiButton-startIcon": { mr: 0.5 },
            }}
          >
            Back
          </ButtonElement>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{ fontSize: "1.125rem", fontWeight: 700, color: "text.primary", lineHeight: 1.2, display: "flex", alignItems: "center", gap: 0.75 }}
            >
              <QrCodeScannerOutlined sx={{ fontSize: 18, color: "primary.main" }} />
              Scan &amp; Pack
            </Typography>
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
              Packlog {batch.batchId} · {options.length} packable order(s)
            </Typography>
          </Box>
        </Stack>

        <ButtonElement
          type="button"
          variant="outlined"
          size="small"
          onClick={() => setPrinterOpen(true)}
          startIcon={<PrintOutlined sx={{ fontSize: 14 }} />}
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
          Printers
        </ButtonElement>
      </Stack>

      {currentMismatch && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <ButtonElement
              type="button"
              size="small"
              variant="outlined"
              onClick={() => setPrinterOpen(true)}
              sx={{ textTransform: "none", whiteSpace: "nowrap" }}
            >
              Change print setting
            </ButtonElement>
          }
        >
          Print setting is not matching with scan mode. Scan mode is{" "}
          <b>{SCANPACK_PART_LABELS[currentMismatch.scanMode]}</b> and print setting is{" "}
          <b>{SCANPACK_PART_LABELS[currentMismatch.printTarget]}</b>. Nothing will print until they match.
        </Alert>
      )}

      {/* Full width, and the scan controls sit on one row — the packlog table
          below is the other half of this screen now, and a half-width column
          would have pushed it off the fold. */}
      <Box
        sx={(t) => ({
          border: `1px solid ${t.palette.divider}`,
          borderRadius: "10px",
          bgcolor: t.palette.background.paper,
          p: 2.25,
          width: "100%",
        })}
      >
        <Stack spacing={2}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1.5}
            alignItems={{ xs: "stretch", md: "flex-start" }}
          >
          {/* Plain field, no dropdown. The bench flow is scan -> print; an
              option list was one more thing to look at and click, and the
              operator never picks from it. Committing the field (Enter, or a
              scanner's trailing Enter) resolves the order and prints it. */}
          <TextField
            size="small"
            fullWidth
            autoFocus
            sx={{ flex: { md: "1 1 auto" }, maxWidth: { md: 520 } }}
            inputRef={inputRef}
            label={`Scan or type ${lookupLabel}`}
            placeholder={
              secondaryFields.length
                ? `Scan the barcode or type the AWB, ${secondaryFields.map((f) => `Listing ${f.label}`).join(" or ")}`
                : "Scan the barcode or type the forward AWB"
            }
            value={awbInput}
            onChange={(event) => setAwbInput(event.target.value)}
            // Enter is an accelerator, not a requirement — the field commits
            // itself after a short pause either way.
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              // Stop the browser treating Enter as a form submit, and stop the
              // page-wide scanner listener seeing it twice.
              event.preventDefault();
              const value = awbInput.trim();
              if (value) void commitAndPrint(value);
            }}
            helperText={
              autoCommitPending
                ? "Printing automatically in 2s — press Enter to print now."
                : " "
            }
            InputProps={{
              endAdornment: runningAction ? (
                <InputAdornment position="end">
                  <CircularProgress size={16} />
                </InputAdornment>
              ) : null,
            }}
          />

          {/* Rendered unconditionally so the operator can pre-arm "copy AWB
              on print" before the first scan of a new packlog — the setting
              is not tied to any particular order. */}
          <FormControlLabel
            sx={{
              ml: 0,
              gap: 0.75,
              flexShrink: 0,
              mt: { md: 0.75 },
              "& .MuiFormControlLabel-label": { lineHeight: 1.25 },
            }}
            control={
              <Checkbox
                size="small"
                checked={copyAwb}
                onChange={(_, checked) => handleCopyAwbChange(checked)}
                sx={{ p: 0.5 }}
              />
            }
            label={
              <Typography sx={{ fontSize: 12.5, color: "text.primary" }}>
                Copy AWB to clipboard on print
              </Typography>
            }
          />

          {selected && (
            <Stack
              direction="row"
              spacing={1}
              flexWrap="wrap"
              useFlexGap
              sx={{ flexShrink: 0, mt: { md: 0.25 } }}
            >
              {actionButton(
                `print:${printTarget}` as Action,
                printLabel,
                <PrintOutlined />,
                !selectedTargetReady
              )}
              {actionButton(
                `download:${printTarget}` as Action,
                downloadLabel,
                <DownloadOutlined />,
                !selectedTargetReady
              )}
            </Stack>
          )}
          </Stack>

          {!selected && (
            <Box
              sx={(t) => ({
                border: `1px dashed ${t.palette.divider}`,
                borderRadius: "8px",
                p: 2,
                textAlign: "center",
                color: t.palette.text.secondary,
              })}
            >
              <Typography sx={{ fontSize: 13 }}>
                Scan or type an {lookupLabel.toLowerCase()} — it prints on its own once the
                field goes quiet. No need to press Enter or click Print.
              </Typography>
            </Box>
          )}

          {selected && (
            <Box sx={(t) => ({ border: `1px solid ${t.palette.divider}`, borderRadius: "8px", p: 2 })}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
                <Typography
                  sx={{ fontSize: 15, fontWeight: 700, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                >
                  {selected.awbRaw || selected.awb || "—"}
                </Typography>
                <Chip
                  size="small"
                  label={
                    hasLabel && hasInvoice
                      ? "Label + Invoice"
                      : hasLabel
                      ? "Label only"
                      : hasInvoice
                      ? "Invoice only"
                      : "Not mapped"
                  }
                  sx={{
                    height: 22,
                    borderRadius: "6px",
                    fontSize: 11,
                    fontWeight: 500,
                    bgcolor: hasLabel || hasInvoice ? "rgba(22,163,74,0.12)" : "rgba(217,119,6,0.14)",
                    color: hasLabel || hasInvoice ? "#15803D" : "#B45309",
                  }}
                />
              </Stack>

              <Divider sx={{ mb: 1.25 }} />

              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 0.75 }}>
                {batch.headers.map((header) => (
                  <Stack key={header} direction="row" spacing={0.75} sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 12, color: "text.secondary", flexShrink: 0 }}>
                      {header}:
                    </Typography>
                    <Typography
                      sx={{ fontSize: 12, fontWeight: 500, color: "text.primary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={selected.raw[header] || "—"}
                    >
                      {selected.raw[header] || "—"}
                    </Typography>
                  </Stack>
                ))}
              </Box>
            </Box>
          )}
        </Stack>
      </Box>

      {/* The packlog, live. Every scan repaints this from the same `batch`
          state the pack flow mutates, so the operator watches rows flip to
          Packed and jump to the top without leaving the bench screen. */}
      <Box sx={{ mt: 2 }}>
        <DataTable
          columns={packColumns}
          rows={pagedPackRows}
          page={packPage}
          limit={packLimit}
          setPage={setPackPage}
          setLimit={setPackLimit}
          totalRow={packRows.length}
          isLoading={loading}
          clientSidePagination
        />
      </Box>

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
    </Page>
  );
};

export default ScanAndPackPack;
