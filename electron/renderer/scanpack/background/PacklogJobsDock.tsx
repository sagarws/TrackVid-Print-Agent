import { Box, CircularProgress, IconButton, LinearProgress, Paper, Stack, Tooltip, Typography } from "@mui/material";
import {
  CheckCircleOutline,
  Close,
  ErrorOutline,
  ExpandLess,
  ExpandMore,
  OpenInNewOutlined,
  StopCircleOutlined,
} from "@mui/icons-material";
import { useState } from "react";
import type { ExtractionJobSummary } from "@shared/types/scanpack";
import { dismissFinishedJobs, dismissPacklogJob, stopPacklogJob, usePacklogJobs, type PacklogJob } from "./packlogJobs";
import { handled, isActive, useExtractionJobs } from "./extractionJobs";

/** The agent's record-PDF extraction, still running after the packlog was made. */
const ExtractionRow = ({ job }: { job: ExtractionJobSummary }) => {
  const total = job.counts.total;
  const done = handled(job);
  return (
    <Box sx={{ px: 1.75, py: 1.25, "& + &": { borderTop: (t) => `1px solid ${t.palette.divider}` } }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <CircularProgress size={14} thickness={5} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }}>
            Saving record PDFs — {job.packlogId}
          </Typography>
          <Typography noWrap sx={{ fontSize: 11, color: "text.secondary" }}>
            {job.orderFileName} · {job.workers} worker{job.workers === 1 ? "" : "s"}
          </Typography>
        </Box>
      </Stack>
      <LinearProgress
        variant={total ? "determinate" : "indeterminate"}
        value={total ? Math.min(100, (done / total) * 100) : undefined}
        sx={{ mt: 0.75, borderRadius: "6px", height: 6 }}
      />
      <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mt: 0.5 }}>
        <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
          {job.state === "queued" ? "Queued…" : "Saving in the background…"}
        </Typography>
        <Typography sx={{ fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
          {done} / {total} records
        </Typography>
      </Stack>
    </Box>
  );
};

const JobRow = ({ job, onOpen }: { job: PacklogJob; onOpen: (packlogObjectId: string) => void }) => {
  const { progress } = job;
  const percent = progress.total ? Math.min(100, ((progress.done ?? 0) / progress.total) * 100) : null;
  return (
    <Box sx={{ px: 1.75, py: 1.25, "& + &": { borderTop: (t) => `1px solid ${t.palette.divider}` } }}>
      <Stack direction="row" alignItems="flex-start" spacing={1}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }} title={job.title}>
            {job.title}
          </Typography>
          <Typography noWrap sx={{ fontSize: 11, color: "text.secondary" }} title={job.subtitle}>
            {job.subtitle}
          </Typography>
        </Box>
        {job.status === "done" && <CheckCircleOutline sx={{ fontSize: 18, color: "success.main" }} />}
        {job.status === "error" && <ErrorOutline sx={{ fontSize: 18, color: "error.main" }} />}
        {job.status === "done" && job.kind === "create" && job.packlogObjectId && (
          <Tooltip title="Open packlog">
            <IconButton size="small" sx={{ p: 0.25 }} onClick={() => onOpen(job.packlogObjectId!)}>
              <OpenInNewOutlined sx={{ fontSize: 16, color: "primary.main" }} />
            </IconButton>
          </Tooltip>
        )}
        {job.status === "running" && job.kind === "print" && (
          <Tooltip title="Stop after the label being printed">
            <span>
              <IconButton
                size="small"
                aria-label="stop printing"
                disabled={job.stopRequested}
                sx={{ p: 0.25 }}
                onClick={() => stopPacklogJob(job.id)}
              >
                <StopCircleOutlined sx={{ fontSize: 18, color: "error.main" }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {job.status !== "running" && (
          <IconButton size="small" aria-label="dismiss" sx={{ p: 0.25 }} onClick={() => dismissPacklogJob(job.id)}>
            <Close sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Stack>

      {job.status === "running" ? (
        <Box sx={{ mt: 0.75 }}>
          <LinearProgress
            variant={percent === null ? "indeterminate" : "determinate"}
            value={percent ?? undefined}
            sx={{ borderRadius: "6px", height: 6 }}
          />
          <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mt: 0.5 }}>
            <Typography noWrap sx={{ fontSize: 11, color: "text.secondary" }}>
              {progress.text || "Working…"}
            </Typography>
            {progress.total ? (
              <Typography sx={{ fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
                {progress.done ?? 0} / {progress.total} {progress.unit}
              </Typography>
            ) : null}
          </Stack>
        </Box>
      ) : (
        <Typography sx={{ mt: 0.5, fontSize: 11, color: job.status === "error" ? "error.main" : "text.secondary" }}>
          {job.message}
        </Typography>
      )}
    </Box>
  );
};

/**
 * Bottom-right panel listing the background packlog jobs, on every page of
 * the app. Hidden when there are none.
 */
const PacklogJobsDock = ({ onOpenPacklog }: { onOpenPacklog: (packlogObjectId: string) => void }) => {
  const jobs = usePacklogJobs();
  const extracting = useExtractionJobs().filter(isActive);
  const [collapsed, setCollapsed] = useState(false);
  if (!jobs.length && !extracting.length) return null;

  const running = jobs.filter((job) => job.status === "running").length + extracting.length;
  return (
    <Paper
      elevation={8}
      sx={{
        position: "fixed",
        right: 20,
        bottom: 20,
        width: 360,
        maxWidth: "calc(100vw - 40px)",
        borderRadius: "10px",
        overflow: "hidden",
        zIndex: (t) => t.zIndex.snackbar - 1,
        border: (t) => `1px solid ${t.palette.divider}`,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 1.75, py: 1, bgcolor: "primary.main", color: "white" }}
      >
        {running > 0 && <CircularProgress size={14} thickness={5} sx={{ color: "white" }} />}
        <Typography sx={{ fontSize: 13, fontWeight: 700, flex: 1, color: "white" }}>
          {running ? `Processing ${running} task${running === 1 ? "" : "s"}…` : "Background tasks finished"}
        </Typography>
        <IconButton size="small" sx={{ color: "white", p: 0.25 }} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <ExpandLess sx={{ fontSize: 18 }} /> : <ExpandMore sx={{ fontSize: 18 }} />}
        </IconButton>
        {!jobs.some((job) => job.status === "running") && jobs.length > 0 && (
          <IconButton size="small" aria-label="close" sx={{ color: "white", p: 0.25 }} onClick={dismissFinishedJobs}>
            <Close sx={{ fontSize: 18 }} />
          </IconButton>
        )}
      </Stack>
      {!collapsed && (
        <Box sx={{ maxHeight: 320, overflowY: "auto", bgcolor: "background.paper" }}>
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} onOpen={onOpenPacklog} />
          ))}
          {extracting.map((job) => (
            <ExtractionRow key={job.id} job={job} />
          ))}
        </Box>
      )}
    </Paper>
  );
};

export default PacklogJobsDock;
