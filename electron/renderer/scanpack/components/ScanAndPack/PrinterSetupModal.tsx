import {
  Alert,
  Box,
  Divider,
  FormControl,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { PrintOutlined, PrintDisabledOutlined, RefreshOutlined } from "@mui/icons-material";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import ButtonElement from "../common/Button";
import DialogShell from "./DialogShell";
import {
  checkAgent,
  isPrinterBlocked,
  listPrinters,
  type AgentPrinter,
} from "../../utils/scan-and-pack/print-agent";
import {
  LOCALSTORAGE_SCANPACK_INVOICE_PRINTER,
  LOCALSTORAGE_SCANPACK_LABEL_PRINTER,
  LOCALSTORAGE_SCANPACK_OUTPUT_MODE,
  LOCALSTORAGE_SCANPACK_PRINT_TARGET,
} from "../../config/constant";
import { readOutputMode, type OutputMode } from "../../utils/scan-and-pack/print-dispatch";

type PrintTarget = "label" | "invoice" | "both";

const readStoredTarget = (): PrintTarget => {
  const raw = localStorage.getItem(LOCALSTORAGE_SCANPACK_PRINT_TARGET);
  return raw === "label" || raw === "invoice" || raw === "both" ? raw : "both";
};

interface Props {
  open: boolean;
  onClose: () => void;
}

type ProbeState =
  | { status: "probing" }
  | { status: "ready"; printers: AgentPrinter[] }
  | { status: "not-allowed"; origin: string }
  | { status: "unavailable" };

/**
 * One dropdown entry per printer the Print Agent reports — nothing else. The
 * live status is part of the label, so an offline printer is visible before
 * it is picked, not after the first parcel falls back to the dialog.
 */
const printerLabel = (printer: AgentPrinter) => {
  const parts = [printer.displayName];
  if (printer.isDefault) parts.push("Default");
  if (printer.status && printer.status.state !== "ready") parts.push(printer.status.message);
  return parts.join(" · ");
};

const persist = (key: string, value: string) => {
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
};

/**
 * Small section-heading component used to group the modal into "Printer
 * Assignment" and "Options" bands, matching the layout of the legacy Print
 * Settings dialog.
 */
const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <Typography
    sx={{
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 0.6,
      textTransform: "uppercase",
      color: "text.secondary",
    }}
  >
    {children}
  </Typography>
);

const PrinterSetupModal = ({ open, onClose }: Props) => {
  const [probe, setProbe] = useState<ProbeState>({ status: "probing" });
  // Read initial values from storage so operators see the same picks they saved
  // on a prior visit, without another round-trip to the print agent.
  const [labelPrinter, setLabelPrinter] = useState<string>(
    () => localStorage.getItem(LOCALSTORAGE_SCANPACK_LABEL_PRINTER) ?? ""
  );
  const [invoicePrinter, setInvoicePrinter] = useState<string>(
    () => localStorage.getItem(LOCALSTORAGE_SCANPACK_INVOICE_PRINTER) ?? ""
  );
  const [printTarget, setPrintTarget] = useState<PrintTarget>(readStoredTarget);
  const [outputMode, setOutputMode] = useState<OutputMode>(readOutputMode);
  // Saved printers the agent no longer reports, cleared on this open.
  const [cleared, setCleared] = useState<string[]>([]);

  /**
   * `refresh` asks the agent to re-check every printer now (Detect Printers);
   * opening the modal takes its last poll, which is at most 10 s old.
   */
  const runProbe = useCallback((refresh = false) => {
    setProbe({ status: "probing" });
    return (async () => {
      const availability = await checkAgent();
      if (availability.status !== "ready") {
        setProbe(availability);
        return;
      }
      try {
        const printers = await listPrinters({ refresh });
        // Only printers the agent reports can be assigned. A saved one it no
        // longer has — removed, renamed, or a QZ Tray-era display name — is
        // cleared rather than kept, so every print goes to a real device.
        const names = new Set(printers.map((p) => p.name));
        const gone: string[] = [];
        const savedLabel = localStorage.getItem(LOCALSTORAGE_SCANPACK_LABEL_PRINTER) ?? "";
        const savedInvoice = localStorage.getItem(LOCALSTORAGE_SCANPACK_INVOICE_PRINTER) ?? "";
        if (savedLabel && !names.has(savedLabel)) {
          gone.push(savedLabel);
          setLabelPrinter("");
          persist(LOCALSTORAGE_SCANPACK_LABEL_PRINTER, "");
        }
        if (savedInvoice && !names.has(savedInvoice)) {
          gone.push(savedInvoice);
          setInvoicePrinter("");
          persist(LOCALSTORAGE_SCANPACK_INVOICE_PRINTER, "");
        }
        setCleared(Array.from(new Set(gone)));
        setProbe({ status: "ready", printers });
      } catch (err) {
        console.warn("[scan-and-pack] failed to list printers", err);
        setProbe({ status: "unavailable" });
      }
    })();
    // Setters and module-level helpers only, so it never changes identity.
  }, []);

  useEffect(() => {
    if (!open) return;
    void runProbe();
  }, [open, runProbe]);

  const handleLabel = (value: string) => {
    setLabelPrinter(value);
    persist(LOCALSTORAGE_SCANPACK_LABEL_PRINTER, value);
  };
  const handleInvoice = (value: string) => {
    setInvoicePrinter(value);
    persist(LOCALSTORAGE_SCANPACK_INVOICE_PRINTER, value);
  };
  const handleOutputMode = (value: OutputMode) => {
    setOutputMode(value);
    localStorage.setItem(LOCALSTORAGE_SCANPACK_OUTPUT_MODE, value);
  };
  const handlePrintTarget = (value: PrintTarget) => {
    setPrintTarget(value);
    // Sticky preference reused across packlogs. The pack page re-reads it
    // when this modal closes and drives the Print/Download buttons off it.
    localStorage.setItem(LOCALSTORAGE_SCANPACK_PRINT_TARGET, value);
  };

  // Print Target is the operator's free first choice, and the assignment
  // below follows from it. It used to be the other way round — the radios
  // were disabled based on which printers were assigned — but with the target
  // asked first that gating is circular: every radio but one would be dead
  // before the operator had assigned anything.
  //
  // Which printer fields are worth showing at all:
  //   label   → only the label printer is ever used
  //   invoice → only the invoice printer is ever used
  //   both    → both, so both are offered and can differ
  const showLabelPrinter = printTarget !== "invoice";
  const showInvoicePrinter = printTarget !== "label";

  // Assigned printers that will not take a job right now, shown under the
  // fields. Only the ones this target actually uses.
  const blockedPicks =
    probe.status === "ready"
      ? probe.printers.filter(
          (printer) =>
            isPrinterBlocked(printer) &&
            ((showLabelPrinter && printer.name === labelPrinter) ||
              (showInvoicePrinter && printer.name === invoicePrinter))
        )
      : [];

  const handleClose = () => {
    // A subtle confirmation so the operator knows the choices survived close.
    if (probe.status === "ready" && (outputMode === "download" || labelPrinter || invoicePrinter)) {
      toast.success("Printer settings saved.");
    }
    onClose();
  };

  return (
    <DialogShell
      open={open}
      onClose={handleClose}
      title="Printer Setup"
      subtitle="Pick which printer handles labels and which handles invoices"
      icon={<PrintOutlined />}
      maxWidth="sm"
      footer={
        <ButtonElement
          type="button"
          variant="contained"
          size="small"
          onClick={handleClose}
          sx={{
            color: "white",
            textTransform: "none",
            fontSize: 13,
            fontWeight: 600,
            px: 2,
            minWidth: 100,
            minHeight: 32,
          }}
        >
          Done
        </ButtonElement>
      }
    >
      {probe.status === "probing" && (
        <Alert
          severity="info"
          variant="outlined"
          sx={{ borderRadius: "6px", "& .MuiAlert-message": { fontSize: 12 }, "& .MuiAlert-icon": { fontSize: 18 } }}
        >
          Looking for the TrackVid Print Agent on this computer…
        </Alert>
      )}

      {(probe.status === "unavailable" || probe.status === "not-allowed") && (
        <Alert
          severity="warning"
          variant="outlined"
          icon={<PrintDisabledOutlined sx={{ fontSize: 18 }} />}
          sx={{ borderRadius: "6px", "& .MuiAlert-message": { fontSize: 12 } }}
          action={
            <ButtonElement
              type="button"
              variant="text"
              size="small"
              onClick={() => void runProbe(true)}
              startIcon={<RefreshOutlined sx={{ fontSize: 14 }} />}
              sx={{ color: "primary.main", textTransform: "none", fontSize: 12, fontWeight: 600 }}
            >
              Detect Printers
            </ButtonElement>
          }
        >
          {probe.status === "unavailable" ? (
            <Stack spacing={0.5}>
              <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                The TrackVid Print Agent is not running on this computer.
              </Typography>
              <Typography sx={{ fontSize: 12 }}>
                Install the TrackVid Print Agent (ask your admin for the installer) and open it,
                then click <b>Detect Printers</b>. Until then, Print buttons fall back to the
                browser print dialog.
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={0.5}>
              <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                The TrackVid Print Agent is running, but does not allow this website.
              </Typography>
              <Typography sx={{ fontSize: 12 }}>
                Open the agent, add <b>{probe.origin}</b> under <b>Allowed websites</b>, then click{" "}
                <b>Detect Printers</b>. Until then, Print buttons fall back to the browser print
                dialog.
              </Typography>
            </Stack>
          )}
        </Alert>
      )}

      {probe.status === "ready" && (
        <Stack spacing={2}>
          <Alert
            severity="success"
            variant="outlined"
            sx={{ borderRadius: "6px", "& .MuiAlert-message": { fontSize: 12 }, "& .MuiAlert-icon": { fontSize: 18 } }}
            action={
              <ButtonElement
                type="button"
                variant="text"
                size="small"
                onClick={() => void runProbe(true)}
                startIcon={<RefreshOutlined sx={{ fontSize: 14 }} />}
                sx={{ color: "primary.main", textTransform: "none", fontSize: 12, fontWeight: 600 }}
              >
                Detect Printers
              </ButtonElement>
            }
          >
            Connected to the TrackVid Print Agent · {probe.printers.length} printer(s) found.
          </Alert>

          {/* AGENT: what a scan does with the PDF — print it, or save it. */}
          <Box>
            <SectionHeading>Output</SectionHeading>
            <FormControl sx={{ mt: 0.5 }}>
              <RadioGroup
                row
                value={outputMode}
                onChange={(_, value) => handleOutputMode(value as OutputMode)}
                sx={{ gap: 1.5 }}
              >
                <FormControlLabel
                  value="print"
                  control={<Radio size="small" />}
                  label={<Typography sx={{ fontSize: 13, fontWeight: 500 }}>Print</Typography>}
                />
                <FormControlLabel
                  value="download"
                  control={<Radio size="small" />}
                  label={<Typography sx={{ fontSize: 13, fontWeight: 500 }}>Auto Download</Typography>}
                />
              </RadioGroup>
            </FormControl>
            <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 0.25 }}>
              {outputMode === "download"
                ? "Each scanned order's PDF is saved to your Downloads folder — no printer, no dialog — and the order is marked Packed once the file is saved."
                : "Each scanned order is printed on the printers below and marked Packed once the printer accepts it."}
            </Typography>
          </Box>

          <Divider />

          {/* Print target first — it decides which parts are ever printed, so
              asking for it up front lets the assignment below show only the
              printers this bench will actually use. Sticky per-machine: the
              pack page reads it at load and each time this modal closes. */}
          <Box>
            <SectionHeading>{outputMode === "download" ? "Download Target" : "Print Target"}</SectionHeading>
            <FormControl sx={{ mt: 0.5 }}>
              <RadioGroup
                row
                value={printTarget}
                onChange={(_, value) => handlePrintTarget(value as PrintTarget)}
                sx={{ gap: 1.5 }}
              >
                <FormControlLabel
                  value="label"
                  control={<Radio size="small" />}
                  label={<Typography sx={{ fontSize: 13, fontWeight: 500 }}>Label</Typography>}
                />
                <FormControlLabel
                  value="invoice"
                  control={<Radio size="small" />}
                  label={<Typography sx={{ fontSize: 13, fontWeight: 500 }}>Invoice</Typography>}
                />
                <FormControlLabel
                  value="both"
                  control={<Radio size="small" />}
                  label={<Typography sx={{ fontSize: 13, fontWeight: 500 }}>Both</Typography>}
                />
              </RadioGroup>
            </FormControl>
            <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 0.25 }}>
              What a scan {outputMode === "download" ? "downloads" : "prints"} on the pack page. It must match the
              packlog's scan mode (Label, Invoice or Both, chosen at upload) — otherwise it is blocked.
            </Typography>
          </Box>

          <Divider />

          {outputMode === "download" ? (
            <Alert severity="info" variant="outlined" sx={{ borderRadius: "6px", "& .MuiAlert-message": { fontSize: 12 } }}>
              No printer is used while <b>Auto Download</b> is on. Files are named{" "}
              <b>{"<AWB>"}-{printTarget}.pdf</b> and saved to your Downloads folder; a name already
              taken gets a number added. Switch back to <b>Print</b> to use the printers.
            </Alert>
          ) : (
          /* Printer Assignment — follows the target above. */
          <Box>
            <SectionHeading>Printer Assignment</SectionHeading>
            <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 0.25 }}>
              {printTarget === "both"
                ? "Pick a printer for each part. Set them to different printers to send labels and invoices to separate devices."
                : `Where every ${printTarget} goes.`}
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ mt: 1 }}>
              {showLabelPrinter && (
                <TextField
                  select
                  size="small"
                  fullWidth
                  label="Label printer"
                  value={labelPrinter}
                  onChange={(event) => handleLabel(event.target.value)}
                  helperText="Sends the label PDF here. Required for printing."
                  FormHelperTextProps={{ sx: { fontSize: 11, mt: 0.5 } }}
                >
                  <MenuItem value="">
                    <em>Not set</em>
                  </MenuItem>
                  {probe.printers.map((printer) => (
                    <MenuItem
                      key={printer.name}
                      value={printer.name}
                      sx={isPrinterBlocked(printer) ? { color: "warning.main" } : undefined}
                    >
                      {printerLabel(printer)}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {showInvoicePrinter && (
                <TextField
                  select
                  size="small"
                  fullWidth
                  label="Invoice printer"
                  value={invoicePrinter}
                  onChange={(event) => handleInvoice(event.target.value)}
                  // Says "label printer" even in Invoice-only mode, where that
                  // field is hidden. Deliberate: leaving this unset really
                  // does fall back to the stored label printer, which lives
                  // in localStorage whether or not it is on screen. Promising
                  // the browser dialog here would be a lie.
                  helperText="Sends the invoice PDF here. Unset reuses the label printer."
                  FormHelperTextProps={{ sx: { fontSize: 11, mt: 0.5 } }}
                >
                  <MenuItem value="">
                    <em>Same as label</em>
                  </MenuItem>
                  {probe.printers.map((printer) => (
                    <MenuItem
                      key={printer.name}
                      value={printer.name}
                      sx={isPrinterBlocked(printer) ? { color: "warning.main" } : undefined}
                    >
                      {printerLabel(printer)}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Stack>

            {probe.printers.length === 0 && (
              <Alert severity="warning" variant="outlined" sx={{ mt: 1.25, borderRadius: "6px", "& .MuiAlert-message": { fontSize: 12 } }}>
                The Print Agent found no printers on this computer. Add the printer in the
                computer&apos;s printer settings, then click <b>Detect Printers</b>.
              </Alert>
            )}

            {cleared.length > 0 && (
              <Alert severity="info" variant="outlined" sx={{ mt: 1.25, borderRadius: "6px", "& .MuiAlert-message": { fontSize: 12 } }}>
                {cleared.map((name) => `"${name}"`).join(" and ")}{" "}
                {cleared.length === 1 ? "is" : "are"} no longer in the Print Agent, so{" "}
                {cleared.length === 1 ? "it was" : "they were"} removed from this setup. Pick a
                printer from the list.
              </Alert>
            )}

            {blockedPicks.map((printer) => (
              <Alert
                key={printer.name}
                severity="warning"
                variant="outlined"
                sx={{ mt: 1.25, borderRadius: "6px", "& .MuiAlert-message": { fontSize: 12 } }}
              >
                <b>{printer.displayName}</b> is {printer.status?.message.toLowerCase() ?? "not ready"}.
                Until it is back, prints to it are refused and the order stays Ready to pack.
              </Alert>
            ))}
          </Box>
          )}

          <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
            Choices are saved on this machine and reused for every Scan &amp; Pack session.
          </Typography>
        </Stack>
      )}
    </DialogShell>
  );
};

export default PrinterSetupModal;
