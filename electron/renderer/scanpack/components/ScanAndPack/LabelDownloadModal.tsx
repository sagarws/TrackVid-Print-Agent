import { Alert, Box, ButtonBase, Stack, TextField, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  CheckCircle,
  FileDownloadOutlined,
  Inventory2Outlined,
  LocalShippingOutlined,
  QrCode2Outlined,
  SellOutlined,
} from "@mui/icons-material";
import { useState, type ReactNode } from "react";
import type { PacklogSortKey } from "@shared/types/scanpack";
import ButtonElement from "../common/Button";
import DialogShell from "./DialogShell";
import { labelSortOptions } from "../../utils/scan-and-pack/sort";
import { BUNDLE_LABELS, DEFAULT_GROUP_SIZE, type BundleBy } from "../../utils/scan-and-pack/bundles";
import { startBundlesDownload } from "../../background/packlogJobs";

interface Props {
  open: boolean;
  onClose: () => void;
  packlog: { id: string; batchId: string; mapped: number; sortKey: PacklogSortKey | null; platformKey: string; scanMode: string };
}

const SORT_ICONS: Record<PacklogSortKey, ReactNode> = {
  sku: <SellOutlined />,
  carrier: <LocalShippingOutlined />,
  distributionCode: <QrCode2Outlined />,
};

const SKU_KINDS: { key: "sku" | "masterSku"; hint: string; icon: ReactNode }[] = [
  { key: "sku", hint: "One PDF per listing SKU from the order list.", icon: <SellOutlined /> },
  { key: "masterSku", hint: "One PDF per master SKU from SKU Mapping.", icon: <Inventory2Outlined /> },
];

const sectionTitle = { fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", color: "text.secondary" } as const;

/** A selectable card: icon, title, optional hint, a check when picked. */
const Choice = ({
  picked,
  onClick,
  icon,
  title,
  hint,
}: {
  picked: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  hint?: string;
}) => (
  <ButtonBase
    onClick={onClick}
    aria-pressed={picked}
    sx={{
      display: "block",
      textAlign: "left",
      px: 1.25,
      py: 1,
      borderRadius: "8px",
      bgcolor: (t) => (picked ? alpha(t.palette.primary.main, 0.08) : t.palette.background.paper),
      border: (t) => `1px solid ${picked ? t.palette.primary.main : t.palette.divider}`,
      "&:hover": { borderColor: "primary.main" },
    }}
  >
    <Stack direction="row" alignItems="center" spacing={1} sx={{ color: "primary.main", "& > svg:first-of-type": { fontSize: 18 } }}>
      {icon}
      <Typography sx={{ fontSize: 13, fontWeight: 700, color: "text.primary", flex: 1 }}>{title}</Typography>
      {picked && <CheckCircle sx={{ fontSize: 16 }} />}
    </Stack>
    {hint && <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.5 }}>{hint}</Typography>}
  </ButtonBase>
);

/**
 * Download a packlog's labels as a ZIP of PDFs, bundled by the packlog's sort
 * (or another one picked here): per listing / master SKU, per carrier, or per
 * distribution code in groups of a chosen size. Built in the background.
 */
const LabelDownloadModal = ({ open, onClose, packlog }: Props) => {
  const sorts = labelSortOptions(packlog.platformKey);
  const initial = sorts.find((o) => o.key === packlog.sortKey)?.key ?? sorts[0]?.key ?? "sku";
  const [sortKey, setSortKey] = useState<PacklogSortKey>(initial);
  const [skuKind, setSkuKind] = useState<"sku" | "masterSku">("sku");
  const [groupSize, setGroupSize] = useState(String(DEFAULT_GROUP_SIZE));

  const size = Math.floor(Number(groupSize));
  const sizeValid = sortKey !== "distributionCode" || (Number.isFinite(size) && size >= 1);
  const by: BundleBy = sortKey === "sku" ? skuKind : sortKey;
  const part = packlog.scanMode === "invoice" ? "invoice" : "label";

  const start = () => {
    if (!sizeValid) return;
    startBundlesDownload(packlog.id, packlog.batchId, { by, groupSize: size || DEFAULT_GROUP_SIZE });
    onClose();
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      busy={false}
      title="Download labels"
      subtitle={`${packlog.batchId} · ${packlog.mapped} ${part}(s)`}
      icon={<FileDownloadOutlined />}
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
            disabled={!sizeValid}
            onClick={start}
            startIcon={<FileDownloadOutlined sx={{ fontSize: 16 }} />}
            sx={{ color: "white", textTransform: "none", fontSize: 13, fontWeight: 600, px: 2.5, minHeight: 32, minWidth: 150 }}
          >
            Download ZIP
          </ButtonElement>
        </>
      }
    >
      <Stack spacing={1}>
        <Typography sx={sectionTitle}>Label sorting by</Typography>
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: `repeat(${sorts.length}, 1fr)` }}>
          {sorts.map((option) => (
            <Choice
              key={option.key}
              picked={option.key === sortKey}
              onClick={() => setSortKey(option.key)}
              icon={SORT_ICONS[option.key]}
              title={option.label}
            />
          ))}
        </Box>
      </Stack>

      {sortKey === "sku" && (
        <Stack spacing={1}>
          <Typography sx={sectionTitle}>SKU type</Typography>
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "1fr 1fr" }}>
            {SKU_KINDS.map((kind) => (
              <Choice
                key={kind.key}
                picked={kind.key === skuKind}
                onClick={() => setSkuKind(kind.key)}
                icon={kind.icon}
                title={BUNDLE_LABELS[kind.key]}
                hint={kind.hint}
              />
            ))}
          </Box>
        </Stack>
      )}

      {sortKey === "distributionCode" && (
        <TextField
          size="small"
          type="number"
          label="Labels per PDF"
          value={groupSize}
          onChange={(event) => setGroupSize(event.target.value)}
          inputProps={{ min: 1, step: 50 }}
          error={!sizeValid}
          helperText={
            sizeValid
              ? `Each distribution code gets its own folder, split into PDFs of up to ${size} ${part}(s).`
              : "Enter a number of 1 or more."
          }
          FormHelperTextProps={{ sx: { fontSize: 11, mt: 0.5 } }}
        />
      )}

      <Alert severity="info" variant="outlined" sx={{ borderRadius: "6px", "& .MuiAlert-message": { fontSize: 12 } }}>
        {sortKey === "distributionCode"
          ? `A ZIP with one folder per distribution code (e.g. B1/B1_1-${size || DEFAULT_GROUP_SIZE}.pdf).`
          : `A ZIP with one PDF per ${BUNDLE_LABELS[by]}.`}{" "}
        It is built in the background and saved to Downloads — progress is in the bottom-right panel.
      </Alert>
    </DialogShell>
  );
};

export default LabelDownloadModal;
