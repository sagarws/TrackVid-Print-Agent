import { Box, Chip, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef } from "@mui/x-data-grid";
import { DeleteOutline, UploadFileOutlined, VisibilityOutlined } from "@mui/icons-material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { Page } from "./Page";
import DataTable from "../components/common/DataTable";
import ButtonElement from "../components/common/Button";
import UploadSessionModal from "../components/ScanAndPack/UploadSessionModal";
import ConfirmationDialog from "../components/common/ConfirmationDialog";
import { getPlatform } from "../utils/scan-and-pack/platforms";
import { PacklogService } from "../api/packlog-service";
import { SCANPACK_PART_LABELS } from "../config/constant";
import type { ScanMode } from "../types/scanAndPack.types";

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
}

const ScanAndPack = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BatchRow | null>(null);
  const [deleting, setDeleting] = useState(false);
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
      const response = await PacklogService.listPacklogs({ page, limit });
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
  }, [page, limit]);

  useEffect(() => {
    void load();
  }, [load]);

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
        field: "actions",
        headerName: "Actions",
        type: "actions",
        width: 110,
        getActions: (params) => [
          <GridActionsCellItem
            key="view"
            icon={<VisibilityOutlined sx={{ width: 18, height: 18, color: "primary.main" }} />}
            label="View"
            onClick={(event) => {
              event.stopPropagation();
              navigate(`/scan-and-pack/${encodeURIComponent(params.row.id)}`);
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
    [navigate]
  );

  return (
    <Page title="Scan and Pack">
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 1.5,
          mb: 2,
          width: "100%",
        }}
      >
        <Box>
          <Typography sx={{ fontSize: "1.125rem", fontWeight: 700, color: "text.primary" }}>
            Upload Packlog files
          </Typography>
          <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.25 }}>
            Each packlog pairs an order list with its label &amp; invoice PDFs and maps them by AWB Number.
          </Typography>
        </Box>

        <ButtonElement
          type="button"
          variant="contained"
          startIcon={<UploadFileOutlined sx={{ fontSize: 14 }} />}
          onClick={() => setUploadOpen(true)}
          sx={{
            color: "white",
            textTransform: "none",
            fontSize: 13,
            fontWeight: 600,
            height: 32,
            px: 2,
            whiteSpace: "nowrap",
            "& .MuiButton-startIcon": { mr: 0.5 },
          }}
        >
          Upload Packlog files
        </ButtonElement>
      </Box>

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
        onRowClicked={(params) => {
          navigate(`/scan-and-pack/${encodeURIComponent(String(params.id))}`);
        }}
        height={{
          xs: "calc((100vh - 220px) / 0.95)",
          sm: "calc((100vh - 220px) / 0.95)",
          md: "calc((100vh - 220px) / 0.95)",
          lg: "calc((100vh - 200px) / 0.95)",
          xl: "calc((100vh - 200px) / 0.95)",
        }}
      />

      {uploadOpen && (
        <UploadSessionModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onCreated={() => {
            setUploadOpen(false);
            // Refetch from the server so the newly-uploaded packlog appears
            // on page 1 with the true server-side `mappedCount`.
            setPage(1);
            void load();
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
    </Page>
  );
};

export default ScanAndPack;
