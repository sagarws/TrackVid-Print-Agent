import { Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import { ErrorOutlineRounded, PrintOutlined } from "@mui/icons-material";
import ButtonElement from "../common/Button";
import { SCANPACK_PART_LABELS } from "../../config/constant";
import type { PrintTargetMismatch } from "../../utils/scan-and-pack/print-dispatch";

interface Props {
  mismatch: PrintTargetMismatch | null;
  onClose: () => void;
  /** Opens Printer Setup so the operator can fix it on the spot. */
  onChangeSettings: () => void;
}

/**
 * Shown instead of printing when Printer Setup's Print Target differs from the
 * packlog's scan mode. Nothing is printed and nothing is marked packed.
 */
const PrintTargetMismatchDialog = ({ mismatch, onClose, onChangeSettings }: Props) => (
  <Dialog open={Boolean(mismatch)} onClose={onClose} maxWidth="xs" fullWidth>
    <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 16, fontWeight: 700 }}>
      <ErrorOutlineRounded sx={{ color: "error.main" }} />
      Print setting not matching
    </DialogTitle>
    {mismatch && (
      <DialogContent>
        <Stack spacing={1.25}>
          <Typography sx={{ fontSize: 13.5, color: "text.primary", lineHeight: 1.6 }}>
            Print setting is not matching with scan mode. Scan mode is{" "}
            <b>{SCANPACK_PART_LABELS[mismatch.scanMode]}</b> and print setting is{" "}
            <b>{SCANPACK_PART_LABELS[mismatch.printTarget]}</b>.
          </Typography>
          <Typography sx={{ fontSize: 13.5, color: "text.secondary" }}>
            Please change the print setting to <b>{SCANPACK_PART_LABELS[mismatch.scanMode]}</b> in Printer Setup.
          </Typography>
        </Stack>
      </DialogContent>
    )}
    <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
      <ButtonElement type="button" variant="outlined" onClick={onClose} sx={{ textTransform: "none" }}>
        Cancel
      </ButtonElement>
      <ButtonElement
        type="button"
        variant="contained"
        onClick={onChangeSettings}
        startIcon={<PrintOutlined />}
        sx={{ textTransform: "none" }}
      >
        Change print setting
      </ButtonElement>
    </DialogActions>
  </Dialog>
);

export default PrintTargetMismatchDialog;
