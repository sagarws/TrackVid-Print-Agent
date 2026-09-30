import { Box, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography } from "@mui/material";
import { CloseOutlined, DescriptionOutlined } from "@mui/icons-material";
import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import PdfJsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Rendered PDF bytes. `null` shows a spinner (still building). */
  bytes: Uint8Array | null;
}

/**
 * Lightweight PDF preview dialog used by the Scan-and-Pack detail grid.
 *
 * AGENT CHANGE: the web app hands the bytes to an <iframe> and lets the
 * browser's PDF viewer draw them. The agent's window has no PDF plugin (and
 * its sandbox + CSP should not grow one for a preview), so each page is drawn
 * to a <canvas> with pdf.js — already bundled for scanning.
 */
const PREVIEW_SCALE = 1.5;

const PdfPages = ({ bytes }: { bytes: Uint8Array }) => {
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const target = holder.current;
    if (!target) return;
    let cancelled = false;
    const worker = pdfjsLib.PDFWorker.fromPort({ port: new PdfJsWorker() });
    // pdf.js takes ownership of the buffer it is given, so hand it a copy.
    const task = pdfjsLib.getDocument({ data: bytes.slice(), worker });
    setError(null);
    target.replaceChildren();

    (async () => {
      const doc = await task.promise;
      for (let pageNo = 1; pageNo <= doc.numPages && !cancelled; pageNo++) {
        const page = await doc.getPage(pageNo);
        const viewport = page.getViewport({ scale: PREVIEW_SCALE * window.devicePixelRatio });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${Math.ceil(viewport.width / window.devicePixelRatio)}px`;
        canvas.style.maxWidth = "100%";
        canvas.style.background = "#fff";
        canvas.style.boxShadow = "0 1px 4px rgba(0,0,0,0.25)";
        const context = canvas.getContext("2d");
        if (!context) continue;
        await page.render({ canvasContext: context, viewport }).promise;
        page.cleanup();
        if (!cancelled) target.appendChild(canvas);
      }
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Could not show this PDF.");
    });

    return () => {
      cancelled = true;
      void task.destroy();
      const port = worker.port;
      worker.destroy();
      port?.terminate();
    };
  }, [bytes]);

  return (
    <Box sx={{ height: "100%", overflow: "auto", py: 3 }}>
      {error && (
        <Typography sx={{ fontSize: 13, color: "error.main", textAlign: "center" }}>{error}</Typography>
      )}
      <Box
        ref={holder}
        sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
      />
    </Box>
  );
};

const PdfPreviewModal = ({ open, onClose, title, subtitle, bytes }: Props) => {

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{ sx: { borderRadius: "10px" } }}
    >
      <DialogTitle sx={{ pr: 6 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: "8px", bgcolor: "rgba(0,136,163,0.12)", color: "primary.main" }}>
            <DescriptionOutlined sx={{ fontSize: 18 }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 700, color: "text.primary", lineHeight: 1.2 }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                {subtitle}
              </Typography>
            )}
          </Box>
        </Stack>
        <IconButton
          onClick={onClose}
          aria-label="Close preview"
          sx={{ position: "absolute", right: 12, top: 12 }}
        >
          <CloseOutlined />
        </IconButton>
      </DialogTitle>
      <DialogContent
        sx={(t) => ({
          padding: 0,
          height: "78vh",
          borderTop: `1px solid ${t.palette.divider}`,
          backgroundColor: t.palette.mode === "dark" ? "#0F172A" : "#F1F5F9",
        })}
      >
        {open && bytes ? (
          <PdfPages bytes={bytes} />
        ) : (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <CircularProgress size={28} />
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PdfPreviewModal;
