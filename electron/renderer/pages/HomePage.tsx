import { Box, Paper, Stack, Typography } from '@mui/material'
import type { AgentState } from '@shared/types/agent'
import StatusCard from '../components/StatusCard'
import PrintersCard from '../components/PrintersCard'
import JobsCard from '../components/JobsCard'
import { formatTime } from '../utils/format'

const HomePage = ({ state, query }: { state: AgentState; query: string }) => {
  const running = state.server.state === 'listening'
  const failed = state.server.state === 'failed'
  const tone = running ? 'success' : failed ? 'error' : 'warning'

  return (
    <Stack spacing={4} sx={{ maxWidth: 1280, mx: 'auto' }}>
      <Stack direction='row' spacing={3} alignItems='flex-start'>
        <Box
          sx={{
            width: 64,
            height: 64,
            flexShrink: 0,
            borderRadius: 3.5,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            boxShadow: '0 10px 24px -10px rgb(var(--mui-palette-primary-mainChannel) / 0.8)'
          }}
        >
          <i className='tabler-printer' style={{ fontSize: 32 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant='h4' sx={{ fontSize: 24, fontWeight: 700 }}>
            TrackVid Print Agent
          </Typography>
          <Typography color='text.secondary' sx={{ mt: 0.5, maxWidth: 560, fontSize: 14 }}>
            Lets TrackVid Scan &amp; Pack print labels and invoices straight to this computer's printers, without a print
            dialog. Keep it running — closing this window keeps it in the{' '}
            {state.platform === 'darwin' ? 'menu bar' : 'system tray'}.
          </Typography>
        </Box>
        <Paper
          variant='outlined'
          sx={{
            px: 3,
            py: 2,
            borderRadius: 3,
            minWidth: 230,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            borderColor: `${tone}.main`,
            bgcolor: `var(--mui-palette-${tone}-lighterOpacity)`
          }}
        >
          <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: `${tone}.main`, flexShrink: 0 }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant='body2' sx={{ fontWeight: 600, color: `${tone}.dark` }}>
              {running ? 'Agent Running' : failed ? 'Agent Stopped' : 'Agent Starting'}
            </Typography>
            <Typography variant='caption' color='text.secondary'>
              Last updated: {formatTime(state.printersCheckedAt)}
            </Typography>
          </Box>
          <Box
            component='i'
            className={running ? 'tabler-circle-check-filled' : failed ? 'tabler-circle-x-filled' : 'tabler-loader-2 animate-spin'}
            sx={{ fontSize: 26, color: `${tone}.main` }}
          />
        </Paper>
      </Stack>

      <StatusCard state={state} />

      {/* Printers and jobs side by side, always — one row at every window width. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4, alignItems: 'stretch' }}>
        <PrintersCard printers={state.printers} error={state.printersError} query={query} />
        <JobsCard jobs={state.jobs} query={query} />
      </Box>
    </Stack>
  )
}

export default HomePage
