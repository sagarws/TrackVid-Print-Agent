import { Alert, Checkbox, CircularProgress, FormControlLabel, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { LocalPrintshopOutlined, PrintOutlined, Refresh } from "@mui/icons-material";
import { useCallback, useEffect, useState } from "react";
import ButtonElement from "../common/Button";
import DialogShell from "./DialogShell";
import { isPrinterBlocked, listPrinters, type AgentPrinter } from "../../utils/scan-and-pack/print-agent";
import { readLabelPrinter } from "../../utils/scan-and-pack/print-dispatch";
import { startSortedLabelsPrint } from "../../background/packlogJobs";

interface Props {
  open: boolean;
  onClose: () => void;
  packlog: { id: string; batchId: string; mapped: number; sortLabel: string; scanMode: string };
}

const printerLabel = (printer: AgentPrinter) => {
  const parts = [printer.displayName];
  if (printer.isDefault) parts.push("Default");
  if (printer.status && printer.status.state !== "ready") parts.push(printer.status.message);
  return parts.join(" · ");
};

/**
 * Print a packlog's labels one by one in its sort order: pick the printer,
 * then Start to print. The printing runs in the background, with progress and
 * a Stop button in the bottom-right panel.
 */
const SortedPrintModal = ({ open, onClose, packlog }: Props) => {
  const [printers, setPrinters] = useState<AgentPrinter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printer, setPrinter] = useState("");
  const [skipPacked, setSkipPacked] = useState(true);

  const load = useCallback(async (refresh = false) => {
    setPrinters(null);
    setError(null);
    try {
      const next = await listPrinters({ refresh });
      setPrinters(next);
      // The Printer Setup label printer first, else the system default.
      setPrinter((current) => {
        if (current && next.some((p) => p.name === current)) return current;
        const saved = readLabelPrinter();
        if (saved && next.some((p) => p.name === saved)) return saved;
        return next.find((p) => p.isDefault)?.name ?? next[0]?.name ?? "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list the printers.");
      setPrinters([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const picked = printers?.find((p) => p.name === printer);
  const part = packlog.scanMode === "invoice" ? "invoice" : "label";

  const start = () => {
    if (!printer) return;
    startSortedLabelsPrint(packlog.id, packlog.batchId, printer, { skipPacked });
    onClose();
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      busy={false}
      title="Print sorted labels"
      subtitle={`${packlog.batchId} · sorted by ${packlog.sortLabel}`}
      icon={<LocalPrintshopOutlined />}
      footer={
        <>
          <ButtonElement
            type="button"
            variant="outlined"
            size="small"
            onClick={onClose}
            sx={{ color: "text.primary", textTransform: "none", fontSize: 13, fontWeight: 500, px: 2, minWidth: 100, minHeight: 32 }}
          >
            Cancel
          </ButtonElement>
          <ButtonElement
            type="button"
            variant="contained"
            size="small"
            disabled={!printer}
            onClick={start}
            startIcon={<PrintOutlined sx={{ fontSize: 16 }} />}
            sx={{ color: "white", textTransform: "none", fontSize: 13, fontWeight: 600, px: 2.5, minHeight: 32, minWidth: 150 }}
          >
            Start to print
          </ButtonElement>
        </>
      }
    >
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          select
          size="small"
          fullWidth
          label="Printer"
          value={printers ? printer : ""}
          disabled={!printers?.length}
          onChange={(event) => setPrinter(event.target.value)}
          helperText={
            printers === null
              ? "Looking for printers…"
              : printers.length
              ? `Each ${part} is sent here one by one, in sort order.`
              : "No printer found. Connect one, then refresh."
          }
          FormHelperTextProps={{ sx: { fontSize: 11, mt: 0.5 } }}
          InputProps={printers === null ? { endAdornment: <CircularProgress size={14} sx={{ mr: 3 }} /> } : undefined}
        >
          {(printers ?? []).map((p) => (
            <MenuItem key={p.name} value={p.name} sx={isPrinterBlocked(p) ? { color: "warning.main" } : undefined}>
              {printerLabel(p)}
            </MenuItem>
          ))}
        </TextField>
        <ButtonElement
          type="button"
          variant="outlined"
          size="small"
          onClick={() => void load(true)}
          disabled={printers === null}
          sx={{ minWidth: 40, height: 40, px: 1, color: "primary.main" }}
          aria-label="refresh printers"
        >
          <Refresh sx={{ fontSize: 18 }} />
        </ButtonElement>
      </Stack>

      {picked && isPrinterBlocked(picked) && (
        <Alert severity="warning" sx={{ fontSize: 12 }}>
          {picked.displayName} is {picked.status?.message.toLowerCase() ?? "not ready"} — labels may wait in its queue.
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ fontSize: 12 }}>
          {error}
        </Alert>
      )}

      <FormControlLabel
        control={<Checkbox size="small" checked={skipPacked} onChange={(event) => setSkipPacked(event.target.checked)} />}
        label={<Typography sx={{ fontSize: 13 }}>Skip orders already printed</Typography>}
      />

      <Alert severity="info" variant="outlined" sx={{ borderRadius: "6px", "& .MuiAlert-message": { fontSize: 12 } }}>
        Up to {packlog.mapped} {part}(s) print in {packlog.sortLabel} order, each one after the printer accepted the one
        before. Every printed order is marked Packed. Progress and Stop are in the bottom-right panel.
      </Alert>
    </DialogShell>
  );
};

export default SortedPrintModal;
