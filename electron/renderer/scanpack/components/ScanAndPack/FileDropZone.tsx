import { Box, IconButton, Stack, Typography } from "@mui/material";
import { Close, CloudUploadOutlined, InsertDriveFileOutlined } from "@mui/icons-material";
import React, { useCallback, useRef, useState } from "react";

interface Props {
  // Optional — the surrounding modal may already render its own section
  // heading (e.g. when the dropzone has sub-content above it). Falsy label →
  // the internal Typography is skipped entirely so we don't stack two
  // headings on top of each other.
  label?: string;
  hint?: string;
  accept: string;
  multiple?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

/**
 * Click-or-drag file picker used by every Scan & Pack modal. Mirrors the look of
 * `ExternalImports/ImportDialogShell` but supports multiple files and more than
 * one picker per dialog.
 */
const FileDropZone = ({ label, hint, accept, multiple = false, files, onChange, disabled }: Props) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const setFiles = useCallback(
    (incoming: File[]) => {
      if (!incoming.length) return;
      onChange(multiple ? [...files, ...incoming] : incoming.slice(0, 1));
    },
    [files, multiple, onChange]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      setFiles(Array.from(event.dataTransfer.files ?? []));
    },
    [disabled, setFiles]
  );

  const removeAt = (index: number) => {
    onChange(files.filter((_, i) => i !== index));
    // Clearing the input lets the operator re-pick the same file straight after
    // removing it — otherwise the change event never fires.
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <Box>
      {label && (
        <Typography
          sx={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", color: "text.secondary", mb: 0.75 }}
        >
          {label}
        </Typography>
      )}

      <Box
        onDrop={handleDrop}
        onDragOver={(event: React.DragEvent) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => !disabled && inputRef.current?.click()}
        sx={(t) => ({
          border: `1.5px dashed ${isDragging ? t.palette.primary.main : t.palette.divider}`,
          borderRadius: "6px",
          px: 2,
          py: 2.25,
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "center",
          opacity: disabled ? 0.6 : 1,
          background: isDragging
            ? "rgba(0,136,163,0.06)"
            : t.palette.mode === "light"
              ? "#FBFCFD"
              : "#0E1428",
          transition: "border-color .2s ease, background .2s ease",
          "&:hover": disabled
            ? undefined
            : { borderColor: t.palette.primary.main, background: "rgba(0,136,163,0.04)" },
        })}
      >
        <Stack alignItems="center" spacing={1}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, rgba(0,136,163,0.10) 0%, rgba(134,207,209,0.18) 100%)",
              color: "primary.main",
            }}
          >
            <CloudUploadOutlined sx={{ fontSize: 20 }} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: "text.primary" }}>
              Click to browse or drag-and-drop
            </Typography>
            <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 0.25 }}>
              {hint ?? `Accepted: ${accept.split(",").join(", ").toUpperCase()}`}
            </Typography>
          </Box>
        </Stack>
      </Box>

      {files.length > 0 && (
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          {files.map((file, index) => (
            <Box
              key={`${file.name}_${index}`}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1.25,
                p: 1,
                borderRadius: "6px",
                border: (t) => `1px solid ${t.palette.divider}`,
                bgcolor: (t) => (t.palette.mode === "light" ? "#FBFCFD" : "#0E1428"),
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
                <InsertDriveFileOutlined sx={{ fontSize: 18, color: "primary.main", flexShrink: 0 }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "text.primary",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {file.name}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
                    {(file.size / 1024).toFixed(1)} KB
                  </Typography>
                </Box>
              </Stack>
              <IconButton
                size="small"
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  removeAt(index);
                }}
                sx={{ color: "text.secondary", "&:hover": { color: "#DC2626", bgcolor: "rgba(220,38,38,0.08)" } }}
              >
                <Close sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          ))}
        </Stack>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: "none" }}
        onChange={(event) => {
          setFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </Box>
  );
};

export default FileDropZone;
