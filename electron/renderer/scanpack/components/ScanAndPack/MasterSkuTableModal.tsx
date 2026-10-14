import { Box, Chip, Dialog, IconButton, InputAdornment, Stack, Typography } from "@mui/material";
import type { GridColDef } from "@mui/x-data-grid";
import { AccountTreeOutlined, Close, Search } from "@mui/icons-material";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { MasterSkuRecord } from "@shared/types/scanpack";
import DataTable from "../common/DataTable";
import TextInput from "../common/TextInput";
import { MasterSkuService } from "../../api/packlog-service";

interface Props {
  open: boolean;
  onClose: () => void;
}

const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };

/**
 * The whole `master-sku` table, full screen: one row per listing SKU with the
 * master SKU it ships as, searchable across both columns.
 */
const MasterSkuTableModal = ({ open, onClose }: Props) => {
  const [records, setRecords] = useState<MasterSkuRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const next = await MasterSkuService.list();
        if (aliveRef.current) setRecords(next);
      } catch (error) {
        if (aliveRef.current) toast.error(error instanceof Error ? error.message : "Could not read the SKU mapping.");
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    })();
  }, []);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    // Grouped by master SKU so each master's listing SKUs read together.
    return records
      .filter(
        (r) => !needle || r.masterSku.toLowerCase().includes(needle) || r.listingSku.toLowerCase().includes(needle)
      )
      .slice()
      .sort((a, b) => a.masterSku.localeCompare(b.masterSku) || a.listingSku.localeCompare(b.listingSku))
      .map((r, i) => ({ ...r, serial: i + 1 }));
  }, [records, search]);

  const masters = useMemo(() => new Set(rows.map((r) => r.masterSku.toUpperCase())).size, [rows]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const pagedRows = useMemo(() => rows.slice((page - 1) * limit, page * limit), [rows, page, limit]);

  const columns: GridColDef[] = useMemo(
    () => [
      { field: "serial", headerName: "#", width: 80, sortable: false },
      {
        field: "masterSku",
        headerName: "Master SKU",
        flex: 1,
        minWidth: 200,
        renderCell: (params) => <Typography sx={{ fontSize: 12.5, fontWeight: 700, ...mono }}>{params.value}</Typography>,
      },
      {
        field: "listingSku",
        headerName: "Listing SKU",
        flex: 1,
        minWidth: 220,
        renderCell: (params) => <Typography sx={{ fontSize: 12.5, ...mono }}>{params.value}</Typography>,
      },
    ],
    []
  );

  return (
    <Dialog open={open} onClose={onClose} fullScreen PaperProps={{ sx: { bgcolor: "background.default" } }}>
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%", p: 2.5, gap: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} flexWrap="wrap">
          <Stack direction="row" alignItems="center" spacing={1.25}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(135deg, rgba(0,136,163,0.10) 0%, rgba(134,207,209,0.18) 100%)",
                color: "primary.main",
              }}
            >
              <AccountTreeOutlined sx={{ fontSize: 18 }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>Master SKU mapping</Typography>
              <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                Every listing SKU and the master SKU it ships as
              </Typography>
            </Box>
            <Chip size="small" label={`${rows.length} listing SKUs`} sx={{ height: 22, borderRadius: "6px", fontSize: 11 }} />
            <Chip size="small" label={`${masters} master SKUs`} sx={{ height: 22, borderRadius: "6px", fontSize: 11 }} />
          </Stack>

          <Stack direction="row" alignItems="center" spacing={1.25}>
            <Box sx={{ width: { xs: 220, sm: 320 } }}>
              <TextInput
                name="master-sku-table-search"
                placeholder="Search master or listing SKU..."
                type="search"
                size="small"
                fullWidth
                autoFocus
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
            <IconButton
              aria-label="close"
              size="small"
              onClick={onClose}
              sx={{
                border: (t) => `1px solid ${t.palette.divider}`,
                borderRadius: "6px",
                "&:hover": { bgcolor: "rgba(0,136,163,0.08)", borderColor: "primary.main" },
              }}
            >
              <Close sx={{ fontSize: 18 }} />
            </IconButton>
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
            xs: "calc((100vh - 120px) / 0.95)",
            sm: "calc((100vh - 120px) / 0.95)",
            md: "calc((100vh - 110px) / 0.95)",
            lg: "calc((100vh - 110px) / 0.95)",
            xl: "calc((100vh - 110px) / 0.95)",
          }}
        />
      </Box>
    </Dialog>
  );
};

export default MasterSkuTableModal;
