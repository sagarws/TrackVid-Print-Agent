import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography
} from '@mui/material'
import type {
  ExtractionJob,
  ExtractionJobSummary,
  JobRecord,
  JobRecordStatus,
  JobState
} from '@shared/types/scanpack'

const STATE_UI: Record<JobState, { label: string; color: 'default' | 'primary' | 'success' | 'warning' | 'error' }> = {
  queued: { label: 'Queued', color: 'default' },
  running: { label: 'Running', color: 'primary' },
  finished: { label: 'Finished', color: 'success' },
  cancelled: { label: 'Cancelled', color: 'warning' },
  interrupted: { label: 'Interrupted', color: 'warning' }
}

const RECORD_UI: Record<JobRecordStatus, { label: string; bg: string; fg: string; border: string }> = {
  pending: { label: 'Waiting', bg: 'action.hover', fg: 'text.secondary', border: 'transparent' },
  running: { label: 'Extracting now', bg: 'action.hover', fg: 'text.primary', border: 'primary.main' },
  done: {
    label: 'PDF extracted and attached',
    bg: 'var(--mui-palette-success-lightOpacity)',
    fg: 'success.dark',
    border: 'transparent'
  },
  missing: {
    label: 'No PDF for this AWB',
    bg: 'var(--mui-palette-error-lightOpacity)',
    fg: 'error.main',
    border: 'transparent'
  },
  failed: {
    label: 'Extraction failed',
    bg: 'var(--mui-palette-error-lightOpacity)',
    fg: 'error.main',
    border: 'error.main'
  }
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')

const duration = (job: ExtractionJobSummary) => {
  if (!job.startedAt) return null
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now()
  const seconds = Math.max(0, (end - new Date(job.startedAt).getTime()) / 1000)
  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
}

/** One record number, coloured by its status; details on hover. */
const RecordChip = ({ record }: { record: JobRecord }) => {
  const ui = RECORD_UI[record.status]
  const tip = (
    <Box sx={{ fontSize: 12 }}>
      <b>Record {record.record}</b> · {record.awb || 'no AWB'}
      <br />
      {ui.label}
      {record.parts.length ? ` · ${record.parts.join(' + ')}` : ''}
      {record.ms !== undefined ? ` · ${record.ms} ms` : ''}
      {record.error ? (
        <>
          <br />
          {record.error}
        </>
      ) : null}
      {record.files?.map(file => (
        <Box key={file} sx={{ opacity: 0.8, wordBreak: 'break-all' }}>
          {file}
        </Box>
      ))}
    </Box>
  )
  return (
    <Tooltip title={tip} arrow>
      <Box
        sx={{
          minWidth: 38,
          height: 28,
          px: 1,
          borderRadius: 1.5,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.5,
          fontSize: 12.5,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          bgcolor: ui.bg,
          color: ui.fg,
          border: '1.5px solid',
          borderColor: ui.border,
          transition: 'background-color 200ms, color 200ms'
        }}
      >
        {record.status === 'running' && <CircularProgress size={10} thickness={6} />}
        {record.record}
      </Box>
    </Tooltip>
  )
}

/** The expanded content: one line per worker, its records in the order it takes them. */
const WorkerLines = ({ job }: { job: ExtractionJob }) => {
  const byWorker = useMemo(() => {
    const lines = new Map<number, JobRecord[]>()
    for (const record of job.records) {
      const list = lines.get(record.worker) ?? []
      list.push(record)
      lines.set(record.worker, list)
    }
    return [...lines.entries()].sort((a, b) => a[0] - b[0])
  }, [job.records])

  return (
    <Stack spacing={2}>
      <Stack direction='row' spacing={2} flexWrap='wrap' useFlexGap sx={{ color: 'text.secondary', fontSize: 12 }}>
        {(['pending', 'running', 'done', 'missing'] as const).map(status => (
          <Stack key={status} direction='row' spacing={0.75} alignItems='center'>
            <Box
              sx={{
                width: 14,
                height: 14,
                borderRadius: 0.75,
                bgcolor: RECORD_UI[status].bg,
                border: '1.5px solid',
                borderColor: RECORD_UI[status].border
              }}
            />
            <span>{RECORD_UI[status].label}</span>
          </Stack>
        ))}
      </Stack>
      {byWorker.map(([worker, records]) => {
        const done = records.filter(r => r.status === 'done').length
        return (
          <Stack key={worker} direction='row' spacing={2} alignItems='flex-start'>
            <Box sx={{ width: 96, flexShrink: 0, pt: 0.5 }}>
              <Typography variant='body2' sx={{ fontWeight: 600 }}>
                Worker {worker}
              </Typography>
              <Typography variant='caption' color='text.secondary'>
                {done} / {records.length} saved
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, flex: 1, minWidth: 0 }}>
              {records.map(record => (
                <RecordChip key={record.orderId} record={record} />
              ))}
            </Box>
          </Stack>
        )
      })}
    </Stack>
  )
}

const JobRow = ({
  job,
  detail,
  expanded,
  onToggle,
  onDelete,
  onRerun
}: {
  job: ExtractionJobSummary
  detail: ExtractionJob | undefined
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
  onRerun: () => void
}) => {
  const { total, done, missing, failed } = job.counts
  const settled = done + missing + failed
  const state = STATE_UI[job.state]
  const took = duration(job)

  return (
    <Paper variant='outlined' sx={{ borderRadius: 3, overflow: 'hidden' }}>
      <Stack
        direction='row'
        alignItems='center'
        spacing={2}
        onClick={onToggle}
        sx={{ px: 2.5, py: 2, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
      >
        <IconButton size='small' aria-label={expanded ? 'Collapse' : 'Expand'}>
          <i className={expanded ? 'tabler-chevron-down' : 'tabler-chevron-right'} style={{ fontSize: 18 }} />
        </IconButton>
        <Box sx={{ minWidth: 0, flex: 1.4 }}>
          <Typography variant='body2' sx={{ fontWeight: 700, fontFamily: 'monospace' }} noWrap>
            {job.packlogId}
          </Typography>
          <Typography variant='caption' color='text.secondary' noWrap component='p'>
            {job.platform} · {job.orderFileName || 'order sheet'} · {when(job.createdAt)}
          </Typography>
        </Box>
        <Box sx={{ flex: 1.2, minWidth: 160 }}>
          <LinearProgress
            variant={job.state === 'queued' ? 'indeterminate' : 'determinate'}
            value={total ? (settled / total) * 100 : 100}
            color={failed ? 'error' : job.state === 'finished' ? 'success' : 'primary'}
            sx={{ height: 6, borderRadius: 3 }}
          />
          <Typography variant='caption' color='text.secondary'>
            {settled} / {total} records · {job.workers} worker{job.workers === 1 ? '' : 's'}
            {took ? ` · ${took}` : ''}
          </Typography>
        </Box>
        <Stack direction='row' spacing={0.75} sx={{ flexShrink: 0 }}>
          <Chip size='small' variant='tonal' color='success' label={`${done} saved`} />
          {missing > 0 && <Chip size='small' variant='tonal' color='error' label={`${missing} no PDF`} />}
          {failed > 0 && <Chip size='small' variant='tonal' color='error' label={`${failed} failed`} />}
          <Chip size='small' variant='outlined' color={state.color} label={state.label} />
        </Stack>
        <Tooltip title="Delete this packlog's saved PDFs and extract them again">
          <span>
            <IconButton
              size='small'
              aria-label='Re-extract'
              disabled={job.state === 'queued'}
              onClick={event => {
                event.stopPropagation()
                onRerun()
              }}
            >
              <i className='tabler-refresh' style={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={job.state === 'running' ? 'Stop and delete this job' : 'Delete from history'}>
          <IconButton
            size='small'
            color='error'
            aria-label='Delete job'
            onClick={event => {
              event.stopPropagation()
              onDelete()
            }}
          >
            <i className='tabler-trash' style={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Stack>
      <Collapse in={expanded} unmountOnExit>
        <Box sx={{ px: 3, py: 2.5, borderTop: '1px solid', borderColor: 'divider' }}>
          {detail ? (
            <WorkerLines job={detail} />
          ) : (
            <Stack direction='row' spacing={1} alignItems='center'>
              <CircularProgress size={16} />
              <Typography variant='body2' color='text.secondary'>
                Loading records…
              </Typography>
            </Stack>
          )}
        </Box>
      </Collapse>
    </Paper>
  )
}

/**
 * Background process: every Scan & Pack extraction job — the per-order PDFs
 * cut after an upload, on N workers — live while it runs, and kept afterwards
 * until deleted.
 */
const BackgroundProcessPage = () => {
  const [jobs, setJobs] = useState<ExtractionJobSummary[] | null>(null)
  const [details, setDetails] = useState<Record<string, ExtractionJob>>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ job: ExtractionJobSummary; action: 'delete' | 'rerun' } | null>(null)

  useEffect(() => {
    let active = true
    // Subscribe first, so an update landing during the first read is not lost.
    const unsubscribe = window.printAgent.scanPack.onJobChanged(({ jobs: next, job }) => {
      if (!active) return
      setJobs(next)
      if (job) setDetails(current => ({ ...current, [job.id]: job }))
    })
    window.printAgent.scanPack
      .listJobs()
      .then(result => {
        if (!active) return
        if (result.ok) setJobs(result.value)
        else setError(result.error)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const toggle = useCallback((id: string) => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else {
        next.add(id)
        void window.printAgent.scanPack.getJob(id).then(result => {
          const job = result.ok ? result.value : null
          if (job) setDetails(existing => ({ ...existing, [id]: job }))
        })
      }
      return next
    })
  }, [])

  const remove = async (job: ExtractionJobSummary) => {
    setConfirm(null)
    const result = await window.printAgent.scanPack.deleteJob(job.id)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setJobs(result.value)
    setDetails(({ [job.id]: _gone, ...rest }) => rest)
  }

  const rerun = async (job: ExtractionJobSummary) => {
    setConfirm(null)
    const result = await window.printAgent.scanPack.rerunJob(job.id)
    if (!result.ok) setError(result.error)
    else setJobs(result.value)
  }

  const running = jobs?.filter(job => job.state === 'running' || job.state === 'queued').length ?? 0

  return (
    <Stack spacing={4} sx={{ maxWidth: 1280, mx: 'auto' }}>
      <Box>
        <Typography variant='h4' sx={{ fontSize: 24, fontWeight: 700 }}>
          Background process
        </Typography>
        <Typography color='text.secondary' sx={{ fontSize: 14, mt: 0.5 }}>
          After an upload, each order's label / invoice PDF is extracted and saved here in the background, on several
          workers at once. Grey is waiting, green is saved, red has no PDF. Orders can be packed and printed before their
          PDF is saved.
          {running ? ` ${running} job${running === 1 ? '' : 's'} running.` : ''}
        </Typography>
      </Box>

      {error && (
        <Alert severity='error' onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {jobs === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={28} />
        </Box>
      ) : jobs.length === 0 ? (
        <Paper variant='outlined' sx={{ borderRadius: 3, p: 6, textAlign: 'center' }}>
          <Typography color='text.secondary'>
            No background jobs yet. Upload a packlog under Scan and Pack and its PDFs are saved here.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          {jobs.map(job => (
            <JobRow
              key={job.id}
              job={job}
              detail={details[job.id]}
              expanded={expanded.has(job.id)}
              onToggle={() => toggle(job.id)}
              onDelete={() => setConfirm({ job, action: 'delete' })}
              onRerun={() => setConfirm({ job, action: 'rerun' })}
            />
          ))}
        </Stack>
      )}

      <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)}>
        <DialogTitle>{confirm?.action === 'rerun' ? 'Extract the PDFs again?' : 'Delete this job?'}</DialogTitle>
        <DialogContent>
          <Typography variant='body2'>
            {confirm?.action === 'rerun'
              ? `The per-order PDFs saved for ${confirm.job.packlogId} are deleted from the folder and cut again from the uploaded file, as a new job. Orders keep printing from the uploaded file meanwhile.`
              : `${
                  confirm?.job.state === 'running'
                    ? 'It is still running: it stops now, and records not yet saved keep printing from the source PDF.'
                    : 'It is removed from this list.'
                } The packlog and the PDFs already saved are not touched.`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button
            color={confirm?.action === 'rerun' ? 'primary' : 'error'}
            variant='contained'
            onClick={() => {
              if (!confirm) return
              void (confirm.action === 'rerun' ? rerun(confirm.job) : remove(confirm.job))
            }}
          >
            {confirm?.action === 'rerun' ? 'Re-extract' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export default BackgroundProcessPage
