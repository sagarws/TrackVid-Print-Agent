import { Alert, Box, Chip, Stack, Typography } from '@mui/material'
import type { AgentState } from '@shared/types/agent'
import SectionCard from './SectionCard'
import { formatTime, platformLabel } from '../utils/format'

const StatusCard = ({ state }: { state: AgentState }) => {
  const { server } = state
  const running = server.state === 'listening'

  return (
    <SectionCard
      icon='tabler-activity'
      title='Status'
      subtitle={`Version ${state.version}`}
      tint={server.state === 'failed' ? 'error' : 'success'}
      action={
        <Chip
          size='small'
          variant='outlined'
          color={running ? 'success' : 'default'}
          icon={<i className='tabler-clock' style={{ fontSize: 14 }} />}
          label={`Updated at ${formatTime(state.printersCheckedAt)}`}
          sx={{ bgcolor: 'background.paper' }}
        />
      }
    >
      <Stack direction='row' spacing={2} alignItems='center' sx={{ pl: 1 }}>
        <Box
          component='i'
          className={running ? 'tabler-circle-check-filled' : server.state === 'failed' ? 'tabler-circle-x-filled' : 'tabler-loader-2'}
          sx={{ fontSize: 26, color: running ? 'success.main' : server.state === 'failed' ? 'error.main' : 'text.secondary' }}
        />
        <Box>
          <Typography variant='body2' sx={{ fontWeight: 600 }}>
            {running
              ? `${platformLabel(state.platform)} agent is running`
              : server.state === 'failed'
                ? 'The agent is not accepting print jobs'
                : 'Starting the print service…'}
          </Typography>
          <Typography variant='caption' color='text.secondary'>
            {running ? `Connected and ready to print · ${server.host}:${server.port}` : 'TrackVid falls back to the print dialog meanwhile.'}
          </Typography>
        </Box>
      </Stack>
      {server.state === 'failed' && (
        <Alert severity='error' sx={{ mt: 3 }}>
          {server.error}
        </Alert>
      )}
    </SectionCard>
  )
}

export default StatusCard
