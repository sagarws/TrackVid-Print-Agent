import { useState } from 'react'
import { Alert, Box, Button, Chip, Collapse, LinearProgress, Stack, Tooltip, Typography } from '@mui/material'
import type { AgentPrinter, PrinterConnection, PrinterState, QueueJob, QueueJobState, Result } from '@shared/types/agent'
import SectionCard from './SectionCard'
import { formatShortTime, matches } from '../utils/format'

type Feedback = { ok: boolean; message: string }
type Tone = 'success' | 'primary' | 'warning' | 'error' | 'secondary'

const STATE_UI: Record<PrinterState, { label: string; color: Tone; icon: string }> = {
  ready: { label: 'Ready', color: 'success', icon: 'tabler-circle-check' },
  printing: { label: 'Printing', color: 'primary', icon: 'tabler-loader-2 animate-spin' },
  paused: { label: 'Paused', color: 'warning', icon: 'tabler-player-pause' },
  offline: { label: 'Offline', color: 'error', icon: 'tabler-wifi-off' },
  error: { label: 'Needs attention', color: 'error', icon: 'tabler-alert-triangle' },
  unknown: { label: 'Unknown', color: 'secondary', icon: 'tabler-help-circle' }
}

const CONNECTION_UI: Record<PrinterConnection, { label: string; icon: string }> = {
  network: { label: 'Network', icon: 'tabler-wifi' },
  usb: { label: 'USB', icon: 'tabler-usb' },
  virtual: { label: 'Virtual', icon: 'tabler-file-type-pdf' },
  unknown: { label: '', icon: 'tabler-printer' }
}

const QUEUE_UI: Record<QueueJobState, { label: string; color: Tone }> = {
  pending: { label: 'Waiting', color: 'secondary' },
  held: { label: 'Held', color: 'warning' },
  printing: { label: 'Printing', color: 'primary' },
  stopped: { label: 'Stopped', color: 'error' },
  cancelled: { label: 'Cancelled', color: 'secondary' },
  aborted: { label: 'Failed', color: 'error' },
  completed: { label: 'Done', color: 'success' }
}

const QUEUE_SHOWN = 8

/** Runs a window action, reports its result on the card. */
type Run = (action: () => Promise<Result>, success?: string) => Promise<void>

const QueueList = ({ printer, run, busy }: { printer: AgentPrinter; run: Run; busy: boolean }) => {
  const [confirmClear, setConfirmClear] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? printer.queue : printer.queue.slice(0, QUEUE_SHOWN)
  const held = printer.queue.filter(job => job.state === 'held').length

  const jobLine = (job: QueueJob) => (
    <Stack key={job.id} direction='row' alignItems='center' spacing={1.5} sx={{ py: 1, px: 2 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant='body2' noWrap sx={{ fontSize: 13 }}>
          {job.name}
          {job.agentJobId ? '' : job.user ? ` · ${job.user}` : ''}
        </Typography>
        <Typography variant='caption' color='text.secondary' noWrap component='p'>
          #{job.id}
          {job.createdAt ? ` · ${new Date(job.createdAt).toLocaleDateString()} ${formatShortTime(job.createdAt)}` : ''}
          {job.reasons.length ? ` · ${job.reasons.join(', ')}` : ''}
        </Typography>
      </Box>
      <Chip size='small' variant='tonal' color={QUEUE_UI[job.state].color} label={QUEUE_UI[job.state].label} />
      {job.state === 'held' && (
        <Button
          size='small'
          disabled={busy}
          onClick={() => void run(() => window.printAgent.releaseQueueJob(printer.name, job.id), `Job #${job.id} released.`)}
          sx={{ minWidth: 0, px: 1, fontSize: 12 }}
        >
          Release
        </Button>
      )}
      <Button
        size='small'
        color='error'
        disabled={busy}
        onClick={() => void run(() => window.printAgent.cancelQueueJob(printer.name, job.id), `Job #${job.id} cancelled.`)}
        sx={{ minWidth: 0, px: 1, fontSize: 12 }}
      >
        Cancel
      </Button>
    </Stack>
  )

  return (
    <Box sx={{ mt: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
      <Stack direction='row' alignItems='center' spacing={1} sx={{ px: 2, py: 1.25, borderBlockEnd: '1px solid', borderColor: 'divider' }}>
        <Typography variant='caption' sx={{ flex: 1, fontWeight: 600 }}>
          {printer.queue.length} job{printer.queue.length === 1 ? '' : 's'} in the queue
          {held ? ` · ${held} held` : ''}
        </Typography>
        {confirmClear ? (
          <>
            <Typography variant='caption' color='error.main'>
              Cancel all {printer.queue.length}?
            </Typography>
            <Button
              size='small'
              color='error'
              variant='contained'
              disabled={busy}
              onClick={() => {
                setConfirmClear(false)
                void run(() => window.printAgent.clearQueue(printer.name), 'Queue cleared.')
              }}
              sx={{ minWidth: 0, px: 1.5, py: 0.25, fontSize: 12 }}
            >
              Yes, clear
            </Button>
            <Button size='small' onClick={() => setConfirmClear(false)} sx={{ minWidth: 0, px: 1, fontSize: 12 }}>
              Keep
            </Button>
          </>
        ) : (
          <Button
            size='small'
            color='error'
            disabled={busy}
            startIcon={<i className='tabler-trash' style={{ fontSize: 14 }} />}
            onClick={() => setConfirmClear(true)}
            sx={{ fontSize: 12 }}
          >
            Clear queue
          </Button>
        )}
      </Stack>
      <Box sx={{ maxHeight: 280, overflow: 'auto' }}>{shown.map(jobLine)}</Box>
      {printer.queue.length > QUEUE_SHOWN && (
        <Box sx={{ px: 2, py: 0.5, textAlign: 'end', borderBlockStart: '1px solid', borderColor: 'divider' }}>
          <Button size='small' onClick={() => setShowAll(value => !value)} sx={{ fontSize: 12 }}>
            {showAll ? 'Show fewer' : `Show all ${printer.queue.length}`}
          </Button>
        </Box>
      )}
    </Box>
  )
}

const Supplies = ({ printer }: { printer: AgentPrinter }) =>
  printer.supplies.length ? (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 1.5, mt: 2 }}>
      {printer.supplies.map(supply => (
        <Tooltip key={supply.name} title={supply.level === null ? 'Level not reported' : `${supply.level}%`}>
          <Box>
            <Typography variant='caption' color='text.secondary' noWrap component='p' sx={{ fontSize: 11 }}>
              {supply.name}
            </Typography>
            <LinearProgress
              variant={supply.level === null ? 'indeterminate' : 'determinate'}
              value={supply.level ?? 0}
              color={supply.level !== null && supply.level <= 10 ? 'error' : 'primary'}
              sx={{
                height: 6,
                borderRadius: 3,
                ...(supply.color && (supply.level ?? 100) > 10
                  ? { '& .MuiLinearProgress-bar': { bgcolor: supply.color } }
                  : {})
              }}
            />
          </Box>
        </Tooltip>
      ))}
    </Box>
  ) : null

const PrinterRow = ({ printer, busy, run }: { printer: AgentPrinter; busy: string | null; run: (name: string) => Run }) => {
  const [queueOpen, setQueueOpen] = useState(false)
  const act = run(printer.name)
  const working = busy === printer.name
  const ui = STATE_UI[printer.status.state]
  const connection = CONNECTION_UI[printer.connection]
  const paused = printer.status.issues.some(issue => issue.code === 'paused') || !printer.status.acceptingJobs
  const problems = printer.status.issues.filter(issue => issue.severity !== 'info')
  const details = [printer.driver, connection.label, printer.location].filter(Boolean).join(' · ')

  return (
    <Box sx={{ px: 3, py: 2.5, borderRadius: 2, bgcolor: 'action.hover' }}>
      <Stack direction='row' alignItems='center' spacing={2}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'background.paper',
            color: `${ui.color}.main`
          }}
        >
          <i className={connection.icon} style={{ fontSize: 18 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant='body2' sx={{ fontWeight: 600 }} noWrap>
            {printer.displayName}
          </Typography>
          <Tooltip title={printer.address ?? ''} placement='bottom-start'>
            <Typography variant='caption' color='text.secondary' noWrap component='p'>
              {printer.name}
              {details ? ` · ${details}` : ''}
            </Typography>
          </Tooltip>
        </Box>
        <Stack direction='row' spacing={1} alignItems='center'>
          {printer.isDefault && <Chip size='small' variant='outlined' label='Default' />}
          <Tooltip title={`${printer.status.message} · checked ${formatShortTime(printer.status.checkedAt)}`}>
            <Chip
              size='small'
              color={ui.color}
              variant='tonal'
              icon={<i className={ui.icon} style={{ fontSize: 14 }} />}
              label={ui.label}
            />
          </Tooltip>
        </Stack>
      </Stack>

      {problems.length > 0 && (
        <Stack spacing={0.5} sx={{ mt: 2, pl: 7 }}>
          {problems.map(issue => (
            <Stack key={issue.code} direction='row' spacing={1} alignItems='center'>
              <Box
                component='i'
                className={issue.severity === 'error' ? 'tabler-alert-circle' : 'tabler-alert-triangle'}
                sx={{ fontSize: 15, color: issue.severity === 'error' ? 'error.main' : 'warning.main', flexShrink: 0 }}
              />
              <Typography variant='caption' sx={{ color: issue.severity === 'error' ? 'error.main' : 'warning.dark' }}>
                {issue.message}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}

      <Box sx={{ pl: 7 }}>
        <Supplies printer={printer} />
      </Box>

      <Stack direction='row' spacing={1} sx={{ mt: 2, pl: 6 }} flexWrap='wrap' useFlexGap>
        {paused && (
          <Button
            size='small'
            variant='contained'
            color='warning'
            disabled={working}
            startIcon={<i className='tabler-player-play' style={{ fontSize: 14 }} />}
            onClick={() => void act(() => window.printAgent.resumePrinter(printer.name), `${printer.displayName} resumed.`)}
            sx={{ fontSize: 12 }}
          >
            Resume
          </Button>
        )}
        <Button
          size='small'
          variant='text'
          disabled={working}
          startIcon={<i className='tabler-file-text' style={{ fontSize: 14 }} />}
          onClick={() => void act(() => window.printAgent.testPrint(printer.name), `Test page queued for ${printer.displayName}.`)}
          sx={{ fontSize: 12 }}
        >
          {working ? 'Working…' : 'Test print'}
        </Button>
        <Button
          size='small'
          variant='text'
          color={printer.queue.length ? 'warning' : 'secondary'}
          disabled={printer.queue.length === 0}
          startIcon={<i className='tabler-list-details' style={{ fontSize: 14 }} />}
          endIcon={
            printer.queue.length ? (
              <i className={queueOpen ? 'tabler-chevron-up' : 'tabler-chevron-down'} style={{ fontSize: 14 }} />
            ) : undefined
          }
          onClick={() => setQueueOpen(value => !value)}
          sx={{ fontSize: 12 }}
        >
          {printer.queue.length ? `Queue (${printer.queue.length})` : 'Queue empty'}
        </Button>
      </Stack>

      <Collapse in={queueOpen && printer.queue.length > 0} unmountOnExit>
        <QueueList printer={printer} run={act} busy={working} />
      </Collapse>
    </Box>
  )
}

const PrintersCard = ({ printers, error, query }: { printers: AgentPrinter[]; error?: string; query: string }) => {
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const shown = printers.filter(printer => matches(query, printer.displayName, printer.name, printer.driver))

  const refresh = async () => {
    setRefreshing(true)
    try {
      await window.printAgent.refreshPrinters()
    } finally {
      setRefreshing(false)
    }
  }

  const run =
    (name: string): Run =>
    async (action, success) => {
      setBusy(name)
      setFeedback(null)
      try {
        const result = await action()
        setFeedback(result.ok ? (success ? { ok: true, message: success } : null) : { ok: false, message: result.error })
      } catch (err) {
        setFeedback({ ok: false, message: err instanceof Error ? err.message : String(err) })
      } finally {
        setBusy(null)
      }
    }

  return (
    <SectionCard
      icon='tabler-printer'
      tone='secondary'
      title='Printers on this Computer'
      subtitle='Live status, checked every few seconds. Choose label and invoice printers in TrackVid → Scan & Pack → Printers.'
      action={
        <Stack direction='row' spacing={1}>
          <Tooltip title='Add or remove printers in system settings'>
            <Button
              size='small'
              variant='outlined'
              color='secondary'
              onClick={() => void window.printAgent.openPrinterSettings()}
              sx={{ minWidth: 0, px: 1.25 }}
              aria-label='Printer settings'
            >
              <i className='tabler-settings' style={{ fontSize: 16 }} />
            </Button>
          </Tooltip>
          <Button
            size='small'
            variant='outlined'
            color='secondary'
            disabled={refreshing}
            startIcon={<i className={refreshing ? 'tabler-loader-2 animate-spin' : 'tabler-refresh'} style={{ fontSize: 16 }} />}
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2}>
        {error && <Alert severity='error'>{error}</Alert>}
        {feedback && (
          <Alert severity={feedback.ok ? 'success' : 'error'} onClose={() => setFeedback(null)}>
            {feedback.message}
          </Alert>
        )}
        {!error && printers.length === 0 && (
          <Typography variant='body2' color='text.secondary'>
            No printers found. Add one in your computer's printer settings, then press Refresh.
          </Typography>
        )}
        {printers.length > 0 && shown.length === 0 && (
          <Typography variant='body2' color='text.secondary'>
            No printer matches "{query}".
          </Typography>
        )}
        {shown.map(printer => (
          <PrinterRow key={printer.name} printer={printer} busy={busy} run={run} />
        ))}
      </Stack>
    </SectionCard>
  )
}

export default PrintersCard
