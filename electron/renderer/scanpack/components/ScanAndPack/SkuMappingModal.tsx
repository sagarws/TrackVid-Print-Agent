import { Alert, Box, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import { AccountTreeOutlined, DeleteOutline, FileDownloadOutlined, TableRowsOutlined } from "@mui/icons-material";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import type { MasterSkuSummary } from "@shared/types/scanpack";
import type { MasterSkuParseResult } from "@shared/utils/masterSku";
import ButtonElement from "../common/Button";
import ConfirmationDialog from "../common/ConfirmationDialog";
import DialogShell from "./DialogShell";
import FileDropZone from "./FileDropZone";
import MasterSkuTableModal from "./MasterSkuTableModal";
import { MasterSkuService } from "../../api/packlog-service";
import { parseMasterSkuSheet } from "../../utils/scan-and-pack/sheet";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SHEET_ACCEPT = ".xlsx,.xls,.csv";

/**
 * SKU Mapping: upload the master SKU sheet (one column per master SKU, its
 * listing SKUs underneath) into the agent's `master-sku` table. Each sheet is
 * merged in — a pair already stored is never added twice — and every
 * packlog's orders are re-tagged, so the Master SKU column and Print by Master
 * SKU follow the new mapping straight away.
 */
const SkuMappingModal = ({ open, onClose }: Props) => {
  const [summary, setSummary] = useState<MasterSkuSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [parsed, setParsed] = useState<MasterSkuParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const loadTable = async () => {
    setLoading(true);
    try {
      const nextSummary = await MasterSkuService.summary();
      if (aliveRef.current) setSummary(nextSummary);
    } catch (error) {
      if (aliveRef.current) toast.error(error instanceof Error ? error.message : "Could not read the SKU mapping.");
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadTable();
  }, []);

  const handleFiles = async (next: File[]) => {
    setFiles(next);
    setParsed(null);
    const file = next[0];
    if (!file) return;
    setParsing(true);
    try {
      const result = await parseMasterSkuSheet(file);
      if (!aliveRef.current) return;
      if (!result.pairs.length) {
        toast.error("No listing SKUs found. Put each master SKU in the first row and its listing SKUs below it.");
        setFiles([]);
        return;
      }
      setParsed(result);
    } catch (error) {
      if (aliveRef.current) {
        toast.error(error instanceof Error ? error.message : "Could not read that sheet.");
        setFiles([]);
      }
    } finally {
      if (aliveRef.current) setParsing(false);
    }
  };

  const handleSave = async () => {
    const file = files[0];
    if (!file || !parsed) return;
    setSaving(true);
    try {
      const result = await MasterSkuService.import(file.name, parsed.pairs);
      if (!aliveRef.current) return;
      const changes = [
        `${result.added} new pair(s) added`,
        ...(result.updated ? [`${result.updated} listing SKU(s) moved to a new master`] : []),
        ...(result.skipped ? [`${result.skipped} already saved, skipped`] : []),
      ].join(", ");
      toast.success(
        `${changes}. Now ${result.total} listing SKU(s) under ${result.masters} master SKU(s).` +
          (result.ordersUpdated ? ` ${result.ordersUpdated} packlog order(s) re-tagged.` : "")
      );
      setFiles([]);
      setParsed(null);
      await loadTable();
    } catch (error) {
      if (aliveRef.current) toast.error(error instanceof Error ? error.message : "Could not save the SKU mapping.");
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await MasterSkuService.clear();
      if (!aliveRef.current) return;
      toast.success("SKU mapping cleared.");
      setConfirmClear(false);
      await loadTable();
    } catch (error) {
      if (aliveRef.current) toast.error(error instanceof Error ? error.message : "Could not clear the SKU mapping.");
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  };

  const downloadTemplate = () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["MASTER_SKU_1", "MASTER_SKU_2"],
      ["LISTING-SKU-A", "LISTING-SKU-C"],
      ["LISTING-SKU-B", ""],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Master SKU");
    XLSX.writeFile(workbook, "master-sku-template.xlsx");
  };

  const busy = saving || parsing;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      busy={busy}
      title="SKU Mapping"
      subtitle="Master SKU → listing SKUs, used to tag every packlog order"
      icon={<AccountTreeOutlined />}
      maxWidth="md"
      footer={
        <>
          <ButtonElement
            type="button"
            variant="outlined"
            size="small"
            onClick={() => setTableOpen(true)}
            disabled={busy || !summary?.total}
            startIcon={<TableRowsOutlined sx={{ fontSize: 14 }} />}
            sx={{
              // Pushes itself to the left; Close and Save stay on the right.
              mr: "auto",
              color: "primary.main",
              textTransform: "none",
              fontSize: 13,
              fontWeight: 600,
              px: 2,
              minHeight: 32,
              whiteSpace: "nowrap",
              "& .MuiButton-startIcon": { mr: 0.5 },
            }}
          >
            Show mapping data
          </ButtonElement>
          <ButtonElement
            type="button"
            variant="outlined"
            size="small"
            onClick={onClose}
            disabled={busy}
            sx={{ color: "text.primary", textTransform: "none", fontSize: 13, fontWeight: 500, px: 2, minWidth: 100, minHeight: 32 }}
          >
            Close
          </ButtonElement>
          <ButtonElement
            type="button"
            variant="contained"
            size="small"
            loading={saving}
            disabled={busy || !parsed}
            onClick={handleSave}
            sx={{ color: "white", textTransform: "none", fontSize: 13, fontWeight: 600, px: 2.5, minHeight: 32, minWidth: 150 }}
          >
            Save Mapping
          </ButtonElement>
        </>
      }
    >
      <Stack spacing={1}>
        <FileDropZone
          label="Master SKU file"
          accept={SHEET_ACCEPT}
          files={files}
          onChange={(next) => void handleFiles(next)}
          disabled={busy}
          hint="XLSX or CSV — each column: master SKU in the first cell, its listing SKUs below"
        />
        <Stack direction="row" alignItems="center" spacing={1} sx={{ pl: 0.25 }}>
          <Typography sx={{ fontSize: 11, color: "text.secondary" }}>Need the layout?</Typography>
          <ButtonElement
            type="button"
            variant="text"
            size="small"
            onClick={downloadTemplate}
            disabled={busy}
            startIcon={<FileDownloadOutlined sx={{ fontSize: 14 }} />}
            sx={{ color: "primary.main", textTransform: "none", fontSize: 12, fontWeight: 600, minHeight: 24, px: 0.5, "& .MuiButton-startIcon": { mr: 0.5 } }}
          >
            Download Template
          </ButtonElement>
        </Stack>
      </Stack>

      {parsing && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={14} />
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>Reading the sheet…</Typography>
        </Stack>
      )}

      {parsed && (
        <Alert severity={parsed.conflicts.length ? "warning" : "info"} sx={{ fontSize: 12 }}>
          Found <b>{parsed.masters}</b> master SKU(s) with <b>{parsed.pairs.length}</b> listing SKU(s). Saving adds
          them to the current mapping{summary?.total ? ` (${summary.total} listing SKUs)` : ""} — pairs already saved
          are skipped, never added twice — and re-tags every packlog.
          {parsed.conflicts.length > 0 && (
            <Box sx={{ mt: 0.5 }}>
              {parsed.conflicts.length} listing SKU(s) appear under two master SKUs — the first column wins:{" "}
              {parsed.conflicts
                .slice(0, 5)
                .map((c) => `${c.listingSku} (kept ${c.kept}, not ${c.dropped})`)
                .join("; ")}
              {parsed.conflicts.length > 5 ? "; …" : ""}
            </Box>
          )}
        </Alert>
      )}

      <Divider flexItem />

      <Stack spacing={1}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
          <Box>
            <Typography
              sx={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", color: "text.secondary" }}
            >
              Current mapping
            </Typography>
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
              {loading
                ? "Loading…"
                : summary?.total
                ? `${summary.total} listing SKU(s) → ${summary.masters} master SKU(s)` +
                  (summary.fileName ? ` · ${summary.fileName}` : "") +
                  (summary.updatedAt ? ` · ${new Date(summary.updatedAt).toLocaleString()}` : "")
                : "No SKU mapping saved yet."}
            </Typography>
          </Box>
          {Boolean(summary?.total) && (
            <ButtonElement
              type="button"
              variant="text"
              size="small"
              onClick={() => setConfirmClear(true)}
              disabled={busy}
              startIcon={<DeleteOutline sx={{ fontSize: 14 }} />}
              sx={{ color: "#DC2626", textTransform: "none", fontSize: 12, fontWeight: 600, minHeight: 24, "& .MuiButton-startIcon": { mr: 0.5 } }}
            >
              Clear mapping
            </ButtonElement>
          )}
        </Stack>
      </Stack>

      {tableOpen && <MasterSkuTableModal open={tableOpen} onClose={() => setTableOpen(false)} />}

      {confirmClear && (
        <ConfirmationDialog
          open={confirmClear}
          onClose={() => setConfirmClear(false)}
          onConfirm={handleClear}
          loading={saving}
          icon={<DeleteOutline sx={{ color: "#DC2626", fontSize: 28 }} />}
          title="Clear the SKU mapping?"
          content="Every listing SKU → master SKU pair is removed, and packlog orders lose their master SKU. Upload the file again to restore it."
        />
      )}
    </DialogShell>
  );
};

export default SkuMappingModal;
