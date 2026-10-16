import { Box, ButtonBase, InputAdornment, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  ArrowBack,
  ArrowForward,
  Check,
  CheckCircle,
  GridViewRounded,
  LightbulbOutlined,
  LocalShippingOutlined,
  QrCode2Outlined,
  SellOutlined,
  ShoppingCartOutlined,
  SortRounded,
  UploadFileOutlined,
} from "@mui/icons-material";
import { useEffect, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import type { PacklogSortKey } from "@shared/types/scanpack";
import { Page } from "./Page";
import ButtonElement from "../components/common/Button";
import { PacklogFilesFields, PacklogUploadInfo } from "../components/ScanAndPack/PacklogFilesFields";
import PacklogListTable from "../components/ScanAndPack/PacklogListTable";
import { PLATFORMS, getPlatform } from "../utils/scan-and-pack/platforms";
import { labelSortOptions } from "../utils/scan-and-pack/sort";
import { startCreatePacklogJob } from "../background/packlogJobs";
import type { ScanMode } from "../types/scanAndPack.types";

const STEPS = [
  { label: "Platform", hint: "Select the platform" },
  { label: "Sorting", hint: "Configure sorting options" },
  { label: "Upload packlog files", hint: "Add and manage files" },
];

const SECTIONS: { title: string; hint: string; icon: ReactNode; tip?: string }[] = [
  {
    title: "1. Select Platform",
    hint: "Platform to sort the labels for.",
    icon: <GridViewRounded sx={{ fontSize: 17 }} />,
    tip: "Pick the platform you're working with — it sets the sorting rules and label format.",
  },
  {
    title: "2. Choose Sorting",
    hint: "Order the labels come out in.",
    icon: <SortRounded sx={{ fontSize: 17 }} />,
    tip: "Labels download in this order, so packers can work through them group by group.",
  },
  {
    title: "3. Upload Packlog Files",
    hint: "Order list and label PDFs.",
    icon: <UploadFileOutlined sx={{ fontSize: 17 }} />,
  },
];

const SORT_DETAILS: Record<PacklogSortKey, { hint: string; icon: ReactNode }> = {
  sku: { hint: "Labels of the same SKU come out together.", icon: <SellOutlined /> },
  carrier: { hint: "Labels grouped by courier, from the order list's Carrier Name column.", icon: <LocalShippingOutlined /> },
  distributionCode: { hint: "Flipkart's B1 / C1 box beside the bottom barcode.", icon: <QrCode2Outlined /> },
};

const buttonSx = { textTransform: "none", fontSize: 13, fontWeight: 600, px: 1.75, minHeight: 30, borderRadius: "8px" } as const;

/** Rounded square tinted with the primary colour, holding an icon. */
const IconTile = ({ children }: { children: ReactNode }) => (
  <Box
    sx={{
      width: 30,
      height: 30,
      flexShrink: 0,
      borderRadius: "8px",
      display: "grid",
      placeItems: "center",
      color: "primary.main",
      bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
    }}
  >
    {children}
  </Box>
);

/** Numbered steps with a subtitle each, connectors, and an underline under the active one. */
const StepHeader = ({ step }: { step: number }) => (
  <Box sx={{ display: "flex", flex: 1, minWidth: 0 }}>
    {STEPS.map((s, i) => {
      const done = i < step;
      const active = i === step;
      const last = i === STEPS.length - 1;
      return (
        <Stack
          key={s.label}
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ flex: last ? "0 0 auto" : 1, py: 1, position: "relative", minWidth: 0 }}
        >
          <Box
            sx={{
              width: 22,
              height: 22,
              flexShrink: 0,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              fontSize: 11.5,
              fontWeight: 700,
              color: "white",
              bgcolor: active || done ? "primary.main" : "grey.400",
            }}
          >
            {done ? <Check sx={{ fontSize: 14 }} /> : i + 1}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              noWrap
              sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.3, color: active ? "text.primary" : "text.secondary" }}
            >
              {s.label}
            </Typography>
            <Typography noWrap sx={{ fontSize: 10.5, lineHeight: 1.3, color: "text.secondary" }}>
              {s.hint}
            </Typography>
          </Box>
          {!last && (
            <Box sx={{ flex: 1, height: "1px", mx: 1.5, minWidth: 24, bgcolor: done ? "primary.main" : "divider" }} />
          )}
          {active && (
            <Box
              sx={{
                position: "absolute",
                left: 0,
                bottom: 0,
                width: 150,
                height: 2,
                borderRadius: 1,
                bgcolor: "primary.main",
              }}
            />
          )}
        </Stack>
      );
    })}
  </Box>
);

/**
 * Sidebar → Label Sorting: pick a platform, pick how its labels are sorted,
 * upload the packlog files. The packlog is created in the background (progress
 * in the bottom-right panel) and lists here and in Scan and Pack, where its
 * labels download in that order.
 */
const LabelSortingPage = ({ onOpenPacklog }: { onOpenPacklog: (packlogObjectId: string) => void }) => {
  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState("flipkart");
  const [sortKey, setSortKey] = useState<PacklogSortKey | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>("label");
  const [sheetFiles, setSheetFiles] = useState<File[]>([]);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);

  const sorts = labelSortOptions(platform);
  // Distribution Code is Flipkart only; switching platform drops it.
  useEffect(() => {
    if (sortKey && !labelSortOptions(platform).some((o) => o.key === sortKey)) setSortKey(null);
  }, [platform, sortKey]);

  const canNext = step === 0 ? Boolean(platform) : step === 1 ? Boolean(sortKey) : false;
  const section = SECTIONS[step] ?? SECTIONS[0]!;
  const platformLabel = getPlatform(platform)?.label ?? platform;

  const create = () => {
    const sheetFile = sheetFiles[0];
    if (!sheetFile) return toast.error("Select the order list (CSV/XLSX) first.");
    if (!pdfFiles.length) return toast.error("Select at least one label PDF.");
    if (!sortKey) return toast.error("Choose how the labels are sorted.");
    startCreatePacklogJob({ sheetFile, pdfFiles, platform, scanMode, sortKey });
    toast.success("Packlog is being created in the background — progress is at the bottom right.");
    setSheetFiles([]);
    setPdfFiles([]);
    setStep(0);
  };

  return (
    // Exactly one window tall (top bar 64px + main padding 2 × 20px): the card
    // keeps its size and the list takes the rest, so its pagination is on
    // screen without scrolling the page.
    <Page
      title="Label Sorting"
      sx={{ height: "calc(100vh - 104px)", minHeight: 520, display: "flex", flexDirection: "column" }}
    >
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 1.25, flexShrink: 0 }}>
        <Box
          sx={{
            width: 34,
            height: 34,
            flexShrink: 0,
            borderRadius: "9px",
            display: "grid",
            placeItems: "center",
            color: "white",
            background: (t) => `linear-gradient(135deg, ${alpha(t.palette.primary.main, 0.7)}, ${t.palette.primary.main})`,
            boxShadow: (t) => `0 3px 10px ${alpha(t.palette.primary.main, 0.3)}`,
          }}
        >
          <SellOutlined sx={{ fontSize: 18 }} />
        </Box>
        <Box>
          <Typography sx={{ fontSize: "1.1rem", fontWeight: 700, color: "text.primary", lineHeight: 1.25 }}>
            Label Sorting
          </Typography>
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
            Choose a platform and a sort, upload the packlog files, then download every label in that order.
          </Typography>
        </Box>
      </Stack>

      {/* One card: steps + Back/Next on top, the current step's fields in a single row below. */}
      <Paper
        variant="outlined"
        sx={{ borderRadius: "12px", overflow: "hidden", flexShrink: 0, mb: 1.5, boxShadow: "0 1px 3px rgba(16,24,40,0.04)" }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={2}
          sx={{ px: 1.5, borderBottom: (t) => `1px solid ${t.palette.divider}` }}
        >
          <StepHeader step={step} />
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <ButtonElement
              type="button"
              variant="outlined"
              size="small"
              disabled={step === 0}
              onClick={() => setStep((s) => s - 1)}
              startIcon={<ArrowBack sx={{ fontSize: 14 }} />}
              sx={{ ...buttonSx, color: "text.primary" }}
            >
              Back
            </ButtonElement>
            {step < 2 ? (
              <ButtonElement
                type="button"
                variant="contained"
                size="small"
                disabled={!canNext}
                onClick={() => setStep((s) => s + 1)}
                endIcon={<ArrowForward sx={{ fontSize: 14 }} />}
                sx={{ ...buttonSx, color: "white", minWidth: 96 }}
              >
                Next
              </ButtonElement>
            ) : (
              <ButtonElement
                type="button"
                variant="contained"
                size="small"
                disabled={!sheetFiles.length || !pdfFiles.length}
                onClick={create}
                startIcon={<UploadFileOutlined sx={{ fontSize: 14 }} />}
                sx={{ ...buttonSx, color: "white", minWidth: 136 }}
              >
                Create Packlog
              </ButtonElement>
            )}
          </Stack>
        </Stack>

        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            alignItems: { md: step === 0 ? "center" : "flex-start" },
            gap: 1.5,
            px: 1.5,
            py: 1.25,
            bgcolor: (t) => alpha(t.palette.primary.main, 0.02),
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ width: { md: 230 }, flexShrink: 0 }}>
            <IconTile>{section.icon}</IconTile>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: "text.primary", lineHeight: 1.3 }}>
                {section.title}
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: "text.secondary", lineHeight: 1.3 }}>
                {step === 2 ? (
                  <>
                    {platformLabel} · sorted by <b>{sorts.find((o) => o.key === sortKey)?.label}</b>
                  </>
                ) : (
                  section.hint
                )}
              </Typography>
            </Box>
          </Stack>

          <Stack spacing={1} sx={{ flex: 1, minWidth: 0, width: { xs: "100%", md: "auto" } }}>
            {step === 0 && (
              <TextField
                select
                size="small"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <ShoppingCartOutlined sx={{ fontSize: 17, color: "primary.main" }} />
                    </InputAdornment>
                  ),
                }}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: "8px", bgcolor: "background.paper", fontSize: 13.5 } }}
              >
                {PLATFORMS.filter((option) => option.enabled).map((option) => (
                  <MenuItem key={option.key} value={option.key}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            )}

            {step === 1 && (
              <>
                <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" } }}>
                  {sorts.map((option) => {
                    const picked = option.key === sortKey;
                    const detail = SORT_DETAILS[option.key];
                    return (
                      <ButtonBase
                        key={option.key}
                        onClick={() => setSortKey(option.key)}
                        aria-pressed={picked}
                        sx={{
                          display: "block",
                          textAlign: "left",
                          px: 1.25,
                          py: 0.75,
                          borderRadius: "8px",
                          bgcolor: (t) => (picked ? alpha(t.palette.primary.main, 0.08) : t.palette.background.paper),
                          border: (t) => `1px solid ${picked ? t.palette.primary.main : t.palette.divider}`,
                          "&:hover": { borderColor: "primary.main" },
                        }}
                      >
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={1}
                          sx={{ color: "primary.main", "& > svg:first-of-type": { fontSize: 17 } }}
                        >
                          {detail.icon}
                          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: "text.primary", flex: 1 }}>
                            {option.label}
                          </Typography>
                          {picked && <CheckCircle sx={{ fontSize: 15 }} />}
                        </Stack>
                        <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 0.25 }}>{detail.hint}</Typography>
                      </ButtonBase>
                    );
                  })}
                </Box>
                {platform !== "flipkart" && (
                  <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
                    Distribution Code sorting is available for Flipkart only.
                  </Typography>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <PacklogFilesFields
                  platform={platform}
                  scanMode={scanMode}
                  setScanMode={setScanMode}
                  sheetFiles={sheetFiles}
                  setSheetFiles={setSheetFiles}
                  pdfFiles={pdfFiles}
                  setPdfFiles={setPdfFiles}
                  busy={false}
                />
                <PacklogUploadInfo />
              </>
            )}
          </Stack>

          {section.tip && (
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{
                width: { xs: "100%", md: 300 },
                flexShrink: 0,
                px: 1.25,
                py: 0.75,
                borderRadius: "8px",
                border: (t) => `1px solid ${alpha(t.palette.primary.main, 0.15)}`,
                bgcolor: (t) => alpha(t.palette.primary.main, 0.05),
              }}
            >
              <LightbulbOutlined sx={{ fontSize: 18, color: "primary.main", flexShrink: 0 }} />
              <Typography sx={{ fontSize: 11.5, color: "text.secondary", lineHeight: 1.35 }}>
                <Box component="span" sx={{ fontWeight: 700, color: "primary.main" }}>
                  Quick Tip:{" "}
                </Box>
                {section.tip}
              </Typography>
            </Stack>
          )}
        </Box>
      </Paper>

      <Typography sx={{ fontSize: 14, fontWeight: 700, mb: 1, flexShrink: 0 }}>Sorted packlogs</Typography>
      {/* The list fills what the card leaves; the grid scrolls its own rows. */}
      <Box sx={{ flex: 1, minHeight: 240, display: "flex", flexDirection: "column" }}>
        <PacklogListTable sortedOnly onOpen={onOpenPacklog} height={{ xs: "100%" }} />
      </Box>
    </Page>
  );
};

export default LabelSortingPage;
