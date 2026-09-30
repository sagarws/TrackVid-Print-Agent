import { Box, Dialog, IconButton, Stack, Typography, useMediaQuery, useTheme } from "@mui/material";
import { Close } from "@mui/icons-material";
import React from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  maxWidth?: "xs" | "sm" | "md" | "lg";
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Blocks the close button / backdrop while a scan is running. */
  busy?: boolean;
}

/** Shared chrome for the Scan & Pack dialogs (60px header, divider, footer). */
const DialogShell = ({
  open,
  onClose,
  title,
  subtitle,
  icon,
  maxWidth = "sm",
  children,
  footer,
  busy = false,
}: Props) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("md"));

  return (
    <Dialog
      open={open}
      fullScreen={fullScreen}
      fullWidth
      maxWidth={maxWidth}
      onClose={(_, reason) => {
        if (busy || reason === "backdropClick") return;
        onClose();
      }}
      PaperProps={{
        sx: {
          borderRadius: "6px",
          bgcolor: "background.paper",
          // Cap the dialog height so it never runs off the viewport. On
          // fullScreen (small screens) the Dialog root already handles this;
          // the cap only matters on md+ where the Paper floats.
          maxHeight: fullScreen ? undefined : "85vh",
          // Paper is a flex column so header + footer stay pinned and the
          // body between them scrolls when its content overflows.
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2.5,
          py: 1.5,
          gap: 2,
          borderBottom: (t) => `1px solid ${t.palette.divider}`,
          flexShrink: 0,
        }}
      >
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
              "& svg": { fontSize: 18 },
            }}
          >
            {icon}
          </Box>
          <Box>
            <Typography sx={{ fontSize: 16, fontWeight: 700, color: "text.primary", lineHeight: 1.2 }}>
              {title}
            </Typography>
            {subtitle && <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{subtitle}</Typography>}
          </Box>
        </Stack>
        <IconButton
          aria-label="close"
          size="small"
          disabled={busy}
          onClick={onClose}
          sx={{
            border: (t) => `1px solid ${t.palette.divider}`,
            borderRadius: "6px",
            "&:hover": { bgcolor: "rgba(0,136,163,0.08)", borderColor: "primary.main" },
          }}
        >
          <Close sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>

      <Box
        sx={{
          p: 2.5,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          // Scroll region: `flex: 1` claims all remaining Paper space,
          // `minHeight: 0` is what actually lets it shrink and scroll inside
          // its flex parent (without this it grows to the content and pushes
          // the footer off-screen).
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        {children}
      </Box>

      {footer && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 1.25,
            px: 2.5,
            py: 1.5,
            borderTop: (t) => `1px solid ${t.palette.divider}`,
            flexShrink: 0,
          }}
        >
          {footer}
        </Box>
      )}
    </Dialog>
  );
};

export default DialogShell;
