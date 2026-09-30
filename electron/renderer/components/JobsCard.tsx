import { useState } from 'react'
import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material'
import type { JobStatus, PrintJob } from '@shared/types/agent'
import SectionCard from './SectionCard'
import { formatShortTime, matches } from '../utils/format'

const COLLAPSED = 5

const STATUS: Record<JobStatus, { label: string; color: 'success' | 'info' | 'error'; icon: string; hint: string }> = {
  done: {
    label: 'Completed',
    color: 'success',
    icon: 'tabler-circle-check',
    hint: "The printer's queue accepted the job."
  },
  printing: { label: 'Printing', color: 'info', icon: 'tabler-loader-2 animate-spin', hint: 'Being sent to the printer.' },
  failed: { label: 'Failed', color: 'error', icon: 'tabler-circle-x', hint: 'The printer refused the job.' }
}

const jobIcon = (name: string) =>
  /invoice/i.test(name) ? 'tabler-file-invoice' : /label/i.test(name) ? 'tabler-file-text' : 'tabler-file'

/** This session's jobs, newest first. Cleared when the agent restarts. */
const JobsCard = ({ jobs, query }: { jobs: PrintJob[]; query: string }) => {
  const [expanded, setExpanded] = useState(false)
  const filtered = jobs.filter(job => matches(query, job.name, job.printer, job.source))
  const shown = expanded ? filtered : filtered.slice(0, COLLAPSED)

  return (
    <SectionCard
      icon='tabler-printer'
      tone='success'
      title='Recent Print Jobs'
      subtitle='Shows the latest print jobs processed by the agent.'
    >
      {filtered.length === 0 ? (
        <Typography variant='body2' color='text.secondary'>
          {query ? `No print job matches "${query}".` : 'Nothing printed since the agent started.'}
        </Typography>
      ) : (
        <Stack spacing={2}>
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
                      {job.source === 'Test print' ? '' : ` · ${job.source.replace(/^https?:\/\//, '')}`}
                    </Typography>
                  </Box>
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
