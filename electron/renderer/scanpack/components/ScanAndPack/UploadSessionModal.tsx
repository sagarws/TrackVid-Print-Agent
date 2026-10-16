import { MenuItem, TextField, Typography } from "@mui/material";
import { CloudUploadOutlined } from "@mui/icons-material";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import ButtonElement from "../common/Button";
import DialogShell from "./DialogShell";
import { PacklogFilesFields, PacklogProgress, PacklogUploadInfo } from "./PacklogFilesFields";
import { PLATFORMS } from "../../utils/scan-and-pack/platforms";
import { announcePacklogResult, createPacklogFromFiles, type CreateProgress } from "../../utils/scan-and-pack/create-packlog";
import type { ScanMode, ScanPackBatch } from "../../types/scanAndPack.types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (batch: ScanPackBatch) => void;
}

const UploadSessionModal = ({ open, onClose, onCreated }: Props) => {
  const [platform, setPlatform] = useState("amazon");
  const [scanMode, setScanMode] = useState<ScanMode>("both");
  const [sheetFiles, setSheetFiles] = useState<File[]>([]);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);

  const [busy, setBusy] = useState(false);
  // What the upload is doing, and — for a step with a known size — how far
  // it has got, so the bar fills and the operator sees "3 / 10 completed".
  const [progress, setProgress] = useState<CreateProgress>({ text: "" });

  // Scanning is a long async walk over every PDF page; if the operator closes
  // the modal midway we must not touch state on an unmounted component.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reset = () => {
    setSheetFiles([]);
    setPdfFiles([]);
    setProgress({ text: "" });
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  /**
   * The modal only closes once everything is on disk, so when the list
   * refetches on `onCreated` the new row already shows its final mapped count.
   */
  const handleSubmit = async () => {
    const sheetFile = sheetFiles[0];
    if (!sheetFile) return toast.error("Select the order list (CSV/XLSX) first.");
    if (!pdfFiles.length) return toast.error("Select at least one label & invoice PDF.");

    setBusy(true);
    try {
      const result = await createPacklogFromFiles({
        sheetFile,
        pdfFiles,
        platform,
        scanMode,
        onProgress: (next) => {
          if (aliveRef.current) setProgress(next);
        },
      });
      if (!aliveRef.current) return;
      announcePacklogResult(result);
      reset();
      onCreated(result.batch);
    } catch (error) {
      if (aliveRef.current) {
        toast.error(error instanceof Error ? error.message : "Could not process the upload.");
      }
    } finally {
      if (aliveRef.current) {
        setBusy(false);
        setProgress({ text: "" });
      }
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={handleClose}
      busy={busy}
      title="Upload Packlog files"
      subtitle="Order list + label/invoice PDFs — matched by AWB Number"
      icon={<CloudUploadOutlined />}
      footer={
        <>
          <ButtonElement
            type="button"
            variant="outlined"
            size="small"
            onClick={handleClose}
            disabled={busy}
            sx={{ color: "text.primary", textTransform: "none", fontSize: 13, fontWeight: 500, px: 2, minWidth: 100, minHeight: 32 }}
          >
            Cancel
          </ButtonElement>
          <ButtonElement
            type="button"
            variant="contained"
            size="small"
            loading={busy}
            disabled={busy || !sheetFiles.length || !pdfFiles.length}
            onClick={handleSubmit}
            sx={{ color: "white", textTransform: "none", fontSize: 13, fontWeight: 600, px: 2.5, minHeight: 32, minWidth: 150 }}
          >
            Create Packlog
          </ButtonElement>
        </>
      }
    >
      <TextField
        select
        size="small"
        label="Platform"
        value={platform}
        disabled={busy}
        onChange={(event) => setPlatform(event.target.value)}
      >
        {PLATFORMS.map((option) => (
          <MenuItem key={option.key} value={option.key} disabled={!option.enabled}>
            {option.label}
            {!option.enabled && (
              <Typography component="span" sx={{ fontSize: 11, color: "text.secondary", ml: 1 }}>
                (coming soon)
              </Typography>
            )}
          </MenuItem>
        ))}
      </TextField>


      <PacklogFilesFields
        platform={platform}
        scanMode={scanMode}
        setScanMode={setScanMode}
        sheetFiles={sheetFiles}
        setSheetFiles={setSheetFiles}
        pdfFiles={pdfFiles}
        setPdfFiles={setPdfFiles}
        busy={busy}
      />

      {busy && <PacklogProgress progress={progress} />}

      {!busy && <PacklogUploadInfo />}
    </DialogShell>
  );
};

export default UploadSessionModal;
