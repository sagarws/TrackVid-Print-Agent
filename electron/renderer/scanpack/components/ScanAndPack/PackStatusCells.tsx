/**
 * Scan & Pack — the Pack Status chip and the Reprint button.
 *
 * Shared because the packlog table and the pack page both show them. Two
 * copies would drift the first time someone changed a colour or the rule for
 * when Reprint is allowed, and the two screens sit one click apart.
 */
import { Chip, CircularProgress, Tooltip } from "@mui/material";
import { PrintOutlined } from "@mui/icons-material";
import { format } from "date-fns";
import ButtonElement from "../common/Button";
import type { PackStatus } from "../../types/scanAndPack.types";

export const PackStatusChip = ({
  status,
  packedAt,
}: {
  status: PackStatus;
  packedAt?: string | null;
}) => {
  const packed = status === "packed";
  return (
    <Chip
      size="small"
      label={packed ? "Packed" : "Ready to pack"}
      title={packed && packedAt ? `Packed ${format(new Date(packedAt), "dd/MM/yyyy hh:mm a")}` : undefined}
      sx={(t) => ({
        height: 22,
        borderRadius: "6px",
        fontSize: 11,
        fontWeight: 600,
        bgcolor: packed ? "rgba(22,163,74,0.12)" : t.palette.action.hover,
        color: packed ? "#15803D" : t.palette.text.secondary,
      })}
    />
  );
};

/**
 * Reprint exists only for a parcel that already went out — there is nothing
 * to *re*print otherwise, and a first print belongs to the scan flow. It
 * never changes pack status: the parcel was packed when it was first printed,
 * and `packedAt` drives the row ordering, so bumping it would shuffle the
 * grid under the operator's hands.
 */
export const ReprintButton = ({
  busy,
  disabled,
  onClick,
}: {
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) => (
  <Tooltip title="Print this parcel again — status and packed time stay as they are">
    <span>
      <ButtonElement
        type="button"
        variant="outlined"
        size="small"
        disabled={disabled}
        onClick={onClick}
        startIcon={
          busy ? <CircularProgress size={12} color="inherit" /> : <PrintOutlined sx={{ fontSize: 14 }} />
        }
        sx={{
          textTransform: "none",
          fontSize: 11.5,
          fontWeight: 600,
          height: 26,
          px: 1.25,
          minWidth: "auto",
        }}
      >
        Reprint
      </ButtonElement>
    </span>
  </Tooltip>
);
