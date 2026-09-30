import type { ReactElement } from "react";
import ButtonElement from "./Button";
import { Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton } from "@mui/material";

interface Props {
  title?: string;
  content?: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmBtnName?: string;
  cancelBtnName?: string;
  confirmBtnColor?: "inherit" | "primary" | "secondary" | "success" | "error" | "info" | "warning";
  isDelete?: boolean;
  icon: ReactElement;
  loading?: boolean;
}

const ConfirmationDialog = ({
  title = "Are you sure?",
  content = "Move to trash.",
  open,
  onClose,
  onConfirm,
  confirmBtnName = "Delete",
  cancelBtnName = "Cancel",
  confirmBtnColor = "error",
  isDelete = true,
  icon,
  loading = false,
}: Props) => {
  return (
    <Dialog maxWidth="sm" fullWidth open={open} onClose={onClose} aria-labelledby="alert-dialog-title" aria-describedby="alert-dialog-description">
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "center",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
        }}
        textAlign="center"
        id="alert-dialog-title"
      >
        <IconButton
          edge="start"
          disableRipple
          sx={{
            cursor: "default",
            backgroundColor: `rgb(${isDelete ? "211, 47, 47, 0.2" : "86, 178, 187, 0.2"})`,
            borderRadius: "100%",
            padding: "25px",
          }}
        >
          {icon}
        </IconButton>
        {title}
      </DialogTitle>
      <DialogContent>
        <DialogContentText textAlign="center" id="alert-dialog-description">
          {content}
        </DialogContentText>
      </DialogContent>
      <DialogActions
        sx={{
          marginBottom: "1rem",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ButtonElement
          type="button"
          variant="outlined"
          sx={{
            color: "primary",
          }}
          onClick={onClose}
          disabled={loading}
        >
          {cancelBtnName}
        </ButtonElement>
        <ButtonElement type="button" variant="contained" color={confirmBtnColor} onClick={onConfirm} loading={loading} disabled={loading}>
          {confirmBtnName}
        </ButtonElement>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmationDialog;
