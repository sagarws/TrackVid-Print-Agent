import { useState } from 'react'
import { Alert, Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material'
import type { JobStatus, PrintJob, Result } from '@shared/types/agent'
import SectionCard from './SectionCard'
import { formatShortTime, matches } from '../utils/format'

const COLLAPSED = 5

type Tone = 'success' | 'info' | 'error' | 'warning' | 'secondary'

const STATUS: Record<JobStatus, { label: string; color: Tone; icon: string; hint: string }> = {
  sending: { label: 'Sending', color: 'info', icon: 'tabler-loader-2 animate-spin', hint: 'Being handed to the print queue.' },
  queued: { label: 'Queued', color: 'info', icon: 'tabler-clock', hint: 'Waiting in the print queue for the printer.' },
  held: { label: 'Held', color: 'warning', icon: 'tabler-player-pause', hint: 'Held in the queue until someone releases it.' },
  printing: { label: 'Printing', color: 'info', icon: 'tabler-loader-2 animate-spin', hint: 'The printer is taking the job now.' },
  done: {
    label: 'Completed',
    color: 'success',
    icon: 'tabler-circle-check',
    hint: 'The job was handed to the printer in full.'
  },
  failed: { label: 'Failed', color: 'error', icon: 'tabler-circle-x', hint: 'The job did not print.' },
  cancelled: { label: 'Cancelled', color: 'secondary', icon: 'tabler-ban', hint: 'The job was cancelled.' }
}

const ACTIVE: readonly JobStatus[] = ['queued', 'held', 'printing']

const jobIcon = (name: string) =>
  /invoice/i.test(name) ? 'tabler-file-invoice' : /label/i.test(name) ? 'tabler-file-text' : 'tabler-file'

/** This session's jobs, newest first. Cleared when the agent restarts. */
const JobsCard = ({ jobs, query }: { jobs: PrintJob[]; query: string }) => {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (id: string, action: () => Promise<Result>) => {
    setBusy(id)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) setError(result.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const filtered = jobs.filter(job => matches(query, job.name, job.printer, job.source))
  const shown = expanded ? filtered : filtered.slice(0, COLLAPSED)

  return (
    <SectionCard
      icon='tabler-printer'
      tone='success'
      title='Recent Print Jobs'
      subtitle='Followed until the printer has taken them — or they fail.'
    >
      {filtered.length === 0 ? (
        <Typography variant='body2' color='text.secondary'>
          {query ? `No print job matches "${query}".` : 'Nothing printed since the agent started.'}
        </Typography>
      ) : (
        <Stack spacing={2}>
          {error && (
            <Alert severity='error' onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
            {shown.map((job, index) => {
              const status = STATUS[job.status]
              return (
                <Stack
                  key={job.id}
                  direction='row'
                  alignItems='center'
                  spacing={2}
                  sx={{ px: 2.5, py: 1.5, borderBlockStart: index ? '1px solid' : 'none', borderColor: 'divider' }}
                >
                  <Box
                    sx={{
                      width: 34,
                      height: 34,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                      bgcolor: 'action.hover',
                      color: 'text.secondary'
                    }}
                  >
                    <i className={jobIcon(job.name)} style={{ fontSize: 17 }} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant='body2' sx={{ fontWeight: 600 }} noWrap>
                      {job.name}
                    </Typography>
                    <Typography variant='caption' color='text.secondary' noWrap component='p'>
                      {formatShortTime(job.startedAt)} · {job.printer}
                      {job.format === 'raw' ? ' · raw' : ''}
                      {job.options?.copies && job.options.copies > 1 ? ` · ${job.options.copies} copies` : ''}
                      {/^https?:/.test(job.source) ? ` · ${job.source.replace(/^https?:\/\//, '')}` : ` · ${job.source}`}
                    </Typography>
                    {(job.error ?? job.message) && (
                      <Tooltip title={job.error ?? job.message}>
                        <Typography
                          variant='caption'
                          noWrap
                          component='p'
                          sx={{ color: job.error ? 'error.main' : 'warning.dark' }}
                        >
                          {job.error ?? job.message}
                        </Typography>
                      </Tooltip>
                    )}
                  </Box>
                  {job.status === 'held' && (
                    <Button
                      size='small'
                      disabled={busy === job.id}
                      onClick={() => void run(job.id, () => window.printAgent.releaseJob(job.id))}
                      sx={{ minWidth: 0, px: 1, fontSize: 12 }}
                    >
                      Release
                    </Button>
                  )}
                  {ACTIVE.includes(job.status) && job.osJobId && (
                    <Button
                      size='small'
                      color='error'
                      disabled={busy === job.id}
                      onClick={() => void run(job.id, () => window.printAgent.cancelJob(job.id))}
                      sx={{ minWidth: 0, px: 1, fontSize: 12 }}
                    >
                      Cancel
                    </Button>
                  )}
                  {job.canReprint && !ACTIVE.includes(job.status) && job.status !== 'sending' && (
                    <Tooltip title='Print this job again'>
                      <Button
                        size='small'
                        disabled={busy === job.id}
                        onClick={() => void run(job.id, () => window.printAgent.reprintJob(job.id))}
                        sx={{ minWidth: 0, px: 1, fontSize: 12 }}
                      >
                        Reprint
                      </Button>
                    </Tooltip>
                  )}
                  <Tooltip title={job.error ?? status.hint}>
                    <Chip
                      size='small'
                      variant='tonal'
                      color={status.color}
                      icon={<i className={status.icon} style={{ fontSize: 14 }} />}
                      label={status.label}
                    />
                  </Tooltip>
                </Stack>
              )
            })}
          </Box>
          {filtered.length > COLLAPSED && (
            <Box sx={{ textAlign: 'end' }}>
              <Button
                size='small'
                variant='text'
                endIcon={<i className={expanded ? 'tabler-chevron-up' : 'tabler-arrow-right'} style={{ fontSize: 16 }} />}
                onClick={() => setExpanded(value => !value)}
              >
                {expanded ? 'Show fewer' : `View all jobs (${filtered.length})`}
              </Button>
            </Box>
          )}
        </Stack>
      )}
    </SectionCard>
  )
}

export default JobsCard
