import { Box, Chip, CircularProgress, LinearProgress, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef } from "@mui/x-data-grid";
import { DeleteOutline, FileDownloadOutlined, PictureAsPdfOutlined, PrintOutlined, VisibilityOutlined } from "@mui/icons-material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import type { PacklogSortKey } from "@shared/types/scanpack";
import DataTable from "../common/DataTable";
import ConfirmationDialog from "../common/ConfirmationDialog";
import SortedPrintModal from "./SortedPrintModal";
import { getPlatform } from "../../utils/scan-and-pack/platforms";
import { PacklogService, adaptPacklogDetail } from "../../api/packlog-service";
import { exportBatchXlsx } from "../../utils/scan-and-pack/export";
import { saveSort, sortLabel, sortOptions, type SortKey } from "../../utils/scan-and-pack/sort";
import { startSortedLabelsDownload, useFinishedCount } from "../../background/packlogJobs";
import { handled, isActive, latestJobByPacklog, useExtractionJobs } from "../../background/extractionJobs";
import { SCANPACK_PART_LABELS } from "../../config/constant";
import type { ScanMode } from "../../types/scanAndPack.types";

interface BatchRow {
  id: string;
  batchId: string;
  platform: string;
  /** Scan Target picked at upload; Print Target must match it to print. */
  scanMode: ScanMode;
  orderFileName: string;
  totalOrders: number;
  mapped: number;
  createdAt: string;
  sortKey: PacklogSortKey | null;
  /** Platform key ("flipkart"), for the sorts it offers. */
  platformKey: string;
}

interface Props {
  /** Label Sorting: only the packlogs created there. */
  sortedOnly?: boolean;
  /** Open a packlog's detail page. */
  onOpen: (packlogObjectId: string) => void;
  /** Bump to reload from page 1 (after a packlog is created). */
  refreshKey?: number;
  /** Grid height; defaults to the rest of the window below a page header. */
  height?: object;
}

/**
 * The packlog list: Scan and Pack shows every packlog, Label Sorting the ones
 * it created. Both can export, open, download the sorted labels and delete.
 */
const PacklogListTable = ({ sortedOnly = false, onOpen, refreshKey = 0, height }: Props) => {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const finishedJobs = useFinishedCount();
  // Each packlog's record-PDF extraction, live from the agent.
  const extractionJobs = useExtractionJobs();
  const jobByPacklog = useMemo(() => latestJobByPacklog(extractionJobs), [extractionJobs]);
  const [pendingDelete, setPendingDelete] = useState<BatchRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Packlog currently being exported, so only that row shows a spinner. */
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  // Server reads resolve after the page may already have been left, so every
  // state write behind an await is gated on the component still being mounted.
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
      // BE paginates, so we ask for the current page directly instead of
      // fetching everything and slicing on the FE. `totalRow` for the grid
      // comes back in the same response.
      const response = await PacklogService.listPacklogs({ page, limit, ...(sortedOnly ? { sorted: true } : {}) });
      // The `get()` helper returns the full AxiosResponse, so `response.data`
      // is the BE envelope `{ isSuccess, message, data: {...} }` and the real
      // payload lives one level deeper. Peel both wrappers.
      const envelope = (
        response as unknown as { data?: { data?: { items?: unknown[]; total?: number } } }
      )?.data?.data;
      const items = Array.isArray(envelope?.items) ? (envelope!.items as Array<{
        _id: string;
        packlogId: string;
        platform: string;
        scanMode?: ScanMode;
        orderFileName: string;
        totalOrders: number;
        mappedCount: number;
        createdAt: string;
        sortKey?: PacklogSortKey | null;
      }>) : [];
      const next: BatchRow[] = items.map((it) => ({
        id: String(it._id),
        batchId: it.packlogId,
        platform: getPlatform(it.platform)?.label ?? it.platform,
        // Packlogs saved before scanMode existed read as "both", the server default.
        scanMode: it.scanMode ?? "both",
        orderFileName: it.orderFileName,
        totalOrders: it.totalOrders ?? 0,
        mapped: it.mappedCount ?? 0,
        createdAt: it.createdAt,
        sortKey: it.sortKey ?? null,
        platformKey: it.platform,
      }));
      if (aliveRef.current) {
        setRows(next);
        setTotal(Number(envelope?.total ?? next.length));
      }
    } catch (error) {
      if (aliveRef.current) {
        toast.error(error instanceof Error ? error.message : "Could not load packlogs.");
      }
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [page, limit, sortedOnly]);

  // A new packlog shows on page 1; a finished background job may have made one.
  useEffect(() => {
    setPage(1);
  }, [refreshKey]);

  useEffect(() => {
    void load();
  }, [load, refreshKey, finishedJobs]);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await PacklogService.deletePacklog(pendingDelete.id);
      toast.success(`Packlog ${pendingDelete.batchId} deleted.`);
      setPendingDelete(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the packlog.");
    } finally {
      setDeleting(false);
    }
  };

  // The list row only carries counts, so the export pulls the full packlog
  // (orders + mappings) the same way its detail page does.
  const handleExport = useCallback(async (row: BatchRow) => {
    setExportingId(row.id);
    try {
      const response = await PacklogService.getPacklog(row.id);
      const envelope = (
        response as unknown as { data?: { data?: { packlog: unknown; orders: unknown[] } } }
      )?.data?.data;
      if (!envelope?.packlog) throw new Error("This packlog no longer exists.");
      exportBatchXlsx(adaptPacklogDetail(envelope as any));
    } catch (error) {
      if (aliveRef.current) {
        toast.error(error instanceof Error ? error.message : "Could not export this packlog.");
      }
    } finally {
      if (aliveRef.current) setExportingId(null);
    }
  }, []);

  /** Packlog whose sorted labels are about to be printed (the printer picker is open). */
  const [printing, setPrinting] = useState<BatchRow | null>(null);
  /** Packlog whose sort is being saved. */
  const [savingSortId, setSavingSortId] = useState<string | null>(null);

  // Saved with the packlog, so its packlog page, Scan & Pack and the sorted-labels download follow it.
  const changeSort = useCallback(async (row: BatchRow, key: SortKey) => {
    setSavingSortId(row.id);
    try {
      await saveSort(row.id, key);
      const sortKey = key === "sheet" ? null : key;
      if (aliveRef.current) setRows((current) => current.map((r) => (r.id === row.id ? { ...r, sortKey } : r)));
      toast.success(`${row.batchId} will be sorted by ${sortLabel(key)}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the sort.");
    } finally {
      if (aliveRef.current) setSavingSortId(null);
    }
  }, []);

  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: "batchId",
        headerName: "Packlog ID",
        flex: 1,
        minWidth: 200,
        renderCell: (params) => (
          <Typography
            sx={{ fontSize: 12, fontWeight: 600, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          >
            {params.value}
          </Typography>
        ),
      },
      {
        field: "createdAt",
        headerName: "Date & Time",
        flex: 1,
        minWidth: 170,
        renderCell: (params) => (
          <Typography sx={{ fontSize: 12, color: "text.primary" }}>
            {format(new Date(params.value), "dd/MM/yyyy hh:mm a")}
          </Typography>
        ),
      },
      {
        field: "platform",
        headerName: "Platform",
        flex: 1,
        minWidth: 110,
        renderCell: (params) => <Typography sx={{ fontSize: 12 }}>{params.value}</Typography>,
      },
      {
        field: "scanMode",
        headerName: "Scan Mode",
        width: 120,
        align: "center",
        headerAlign: "center",
        renderCell: (params) => (
          <Chip
            size="small"
            variant="outlined"
            color="primary"
            label={SCANPACK_PART_LABELS[params.value as ScanMode]}
            sx={{ height: 22, borderRadius: "6px", fontSize: 11, fontWeight: 600 }}
          />
        ),
      },
      {
        field: "totalOrders",
        headerName: "Orders",
        width: 90,
        renderCell: (params) => <Typography sx={{ fontSize: 12 }}>{params.value}</Typography>,
      },
      {
        field: "mapped",
        headerName: "Mapped",
        width: 140,
        renderCell: (params) => {
          const total = params.row.totalOrders as number;
          const mapped = params.value as number;
          const complete = total > 0 && mapped === total;
          return (
            <Chip
              size="small"
              label={`${mapped} / ${total}`}
              sx={{
                height: 22,
                borderRadius: "6px",
                fontSize: 11,
                fontWeight: 500,
                bgcolor: complete ? "rgba(22,163,74,0.12)" : "rgba(217,119,6,0.14)",
                color: complete ? "#15803D" : "#B45309",
              }}
            />
          );
        },
      },
      {
        field: "sortKey",
        headerName: "Label Sort",
        width: 170,
        sortable: false,
        renderCell: (params) => {
          const row = params.row as BatchRow;
          return (
            // Clicks on the select (and its menu, a portal) must not open the packlog.
            <Box onClick={(event) => event.stopPropagation()} sx={{ display: "flex", alignItems: "center", height: "100%" }}>
              <TextField
                select
                size="small"
                variant="standard"
                value={row.sortKey ?? "sheet"}
                disabled={savingSortId === row.id}
                onChange={(event) => void changeSort(row, event.target.value as SortKey)}
                InputProps={{ disableUnderline: true }}
                sx={{ minWidth: 140, "& .MuiInputBase-input": { fontSize: 12, fontWeight: 600, color: "primary.main", py: 0.25 } }}
              >
                {sortOptions({ platform: row.platformKey }).map((option) => (
                  <MenuItem key={option.key} value={option.key} sx={{ fontSize: 12.5 }}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          );
        },
      },
      {
        field: "background",
        headerName: "Background process",
        width: 200,
        sortable: false,
        renderCell: (params) => {
          const job = jobByPacklog.get(String(params.row.id));
          if (!job) return <Typography sx={{ fontSize: 12, color: "text.disabled" }}>—</Typography>;
          const done = handled(job);
          const total = job.counts.total;
          if (isActive(job)) {
            return (
              <Stack direction="row" alignItems="center" spacing={1} sx={{ width: "100%", height: "100%" }}>
                <CircularProgress size={14} thickness={5} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <LinearProgress
                    variant={total ? "determinate" : "indeterminate"}
                    value={total ? Math.min(100, (done / total) * 100) : undefined}
                    sx={{ height: 5, borderRadius: "6px" }}
                  />
                  <Typography sx={{ fontSize: 10.5, color: "text.secondary", lineHeight: 1.4, mt: 0.25 }}>
                    {job.state === "queued" ? "Queued" : `${done} / ${total} saved`}
                  </Typography>
                </Box>
              </Stack>
            );
          }
          const failed = job.counts.missing + job.counts.failed;
          return (
            <Typography
              sx={{ fontSize: 12, fontWeight: 600, color: job.state === "finished" && !failed ? "#15803D" : "#B45309" }}
            >
              {job.state === "finished"
                ? failed
                  ? `${job.counts.done} saved · ${failed} no PDF`
                  : `${job.counts.done} saved`
                : job.state === "cancelled"
                ? "Cancelled"
                : "Interrupted"}
            </Typography>
          );
        },
      },
      {
        field: "actions",
        headerName: "Actions",
        type: "actions",
        width: 200,
        getActions: (params) => [
          <GridActionsCellItem
            key="print-sorted"
            icon={<PrintOutlined sx={{ width: 18, height: 18, color: "primary.main" }} />}
            label="Print sorted labels"
            title="Print all labels one by one, sorted"
            disabled={(params.row as BatchRow).mapped === 0}
            onClick={(event) => {
              event.stopPropagation();
              setPrinting(params.row as BatchRow);
            }}
            // DataGrid v8 dropped `sx` from this component's type but still
            // forwards it to the IconButton; a spread skips the excess-prop check.
            {...{ sx: { margin: "0 2px", padding: "4px", borderRadius: "6px", "&:hover": { backgroundColor: "rgba(0,136,163,0.08)" } } }}
          />,
          <GridActionsCellItem
            key="export"
            icon={
              exportingId === params.row.id ? (
                <CircularProgress size={16} />
              ) : (
                <FileDownloadOutlined sx={{ width: 18, height: 18, color: "primary.main" }} />
              )
            }
            label="Export"
            title="Export to Excel"
            disabled={exportingId !== null}
            onClick={(event) => {
              event.stopPropagation();
              void handleExport(params.row as BatchRow);
            }}
            // DataGrid v8 dropped `sx` from this component's type but still
            // forwards it to the IconButton; a spread skips the excess-prop check.
            {...{ sx: { margin: "0 2px", padding: "4px", borderRadius: "6px", "&:hover": { backgroundColor: "rgba(0,136,163,0.08)" } } }}
          />,
          <GridActionsCellItem
            key="sorted-labels"
            icon={<PictureAsPdfOutlined sx={{ width: 18, height: 18, color: "primary.main" }} />}
            label="Download sorted labels"
            title="Download all labels, sorted"
            disabled={(params.row as BatchRow).mapped === 0}
            onClick={(event) => {
              event.stopPropagation();
              const row = params.row as BatchRow;
              startSortedLabelsDownload(row.id, row.batchId);
            }}
            // DataGrid v8 dropped `sx` from this component's type but still
            // forwards it to the IconButton; a spread skips the excess-prop check.
            {...{ sx: { margin: "0 2px", padding: "4px", borderRadius: "6px", "&:hover": { backgroundColor: "rgba(0,136,163,0.08)" } } }}
          />,
          <GridActionsCellItem
            key="view"
            icon={<VisibilityOutlined sx={{ width: 18, height: 18, color: "primary.main" }} />}
            label="View"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(String(params.row.id));
            }}
            // DataGrid v8 dropped `sx` from this component's type but still
            // forwards it to the IconButton; a spread skips the excess-prop check.
            {...{ sx: { margin: "0 2px", padding: "4px", borderRadius: "6px", "&:hover": { backgroundColor: "rgba(0,136,163,0.08)" } } }}
          />,
          <GridActionsCellItem
            key="delete"
            icon={<DeleteOutline sx={{ width: 18, height: 18, color: "#DC2626" }} />}
            label="Delete"
            onClick={(event) => {
              event.stopPropagation();
              setPendingDelete(params.row as BatchRow);
            }}
            // DataGrid v8 dropped `sx` from this component's type but still
            // forwards it to the IconButton; a spread skips the excess-prop check.
            {...{ sx: { margin: "0 2px", padding: "4px", borderRadius: "6px", "&:hover": { backgroundColor: "rgba(220,38,38,0.08)" } } }}
          />,
        ],
      },
    ],
    [onOpen, exportingId, handleExport, jobByPacklog, savingSortId, changeSort]
  );

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        page={page}
        limit={limit}
        setPage={setPage}
        setLimit={setLimit}
        totalRow={total}
        rowHeight={36}
        isLoading={loading}
        onRowClicked={(params) => onOpen(String(params.id))}
        height={
          height ?? {
            xs: "calc((100vh - 220px) / 0.95)",
            sm: "calc((100vh - 220px) / 0.95)",
            md: "calc((100vh - 220px) / 0.95)",
            lg: "calc((100vh - 200px) / 0.95)",
            xl: "calc((100vh - 200px) / 0.95)",
          }
        }
      />

      {printing && (
        <SortedPrintModal
          open={Boolean(printing)}
          onClose={() => setPrinting(null)}
          packlog={{
            id: printing.id,
            batchId: printing.batchId,
            mapped: printing.mapped,
            sortLabel: sortLabel(printing.sortKey),
            scanMode: printing.scanMode,
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmationDialog
          open={Boolean(pendingDelete)}
          onClose={() => setPendingDelete(null)}
          onConfirm={handleDelete}
          loading={deleting}
          icon={<DeleteOutline sx={{ color: "#DC2626", fontSize: 28 }} />}
          title={`Delete packlog ${pendingDelete.batchId}?`}
          content="The order rows and the stored label/invoice PDFs for this packlog will be removed from this browser. This cannot be undone."
        />
      )}
    </>
  );
};

export default PacklogListTable;
