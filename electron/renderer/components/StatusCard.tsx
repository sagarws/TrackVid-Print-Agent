import { Box, Chip, Paper, Stack, Tooltip, Typography } from '@mui/material'
import type { AgentState } from '@shared/types/agent'
import IconTile from './IconTile'
import { formatTime, platformLabel } from '../utils/format'

/** The agent's own state, on one line. */
const StatusCard = ({ state }: { state: AgentState }) => {
  const { server } = state
  const running = server.state === 'listening'
  const failed = server.state === 'failed'
  const tone = running ? 'success' : failed ? 'error' : 'warning'

  const headline = running
    ? `${platformLabel(state.platform)} agent is running`
    : failed
      ? 'Not accepting print jobs'
      : 'Starting the print service…'
  const detail = running
    ? `Connected and ready to print · ${server.host}:${server.port}`
    : failed
      ? `${server.error} TrackVid falls back to the print dialog meanwhile.`
      : 'TrackVid falls back to the print dialog meanwhile.'

  return (
    <Paper
      variant='outlined'
      sx={{
        px: 3,
        py: 2,
        borderRadius: 3,
        display: 'flex',
        alignItems: 'center',
        gap: 2.5,
        bgcolor: `var(--mui-palette-${tone}-lighterOpacity)`
      }}
    >
      <IconTile icon='tabler-activity' tone={tone} size={36} />
      <Stack sx={{ flexShrink: 0 }}>
        <Typography variant='body2' sx={{ fontWeight: 600 }}>
          Status
        </Typography>
        <Typography variant='caption' color='text.secondary'>
          v{state.version}
        </Typography>
      </Stack>
      <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'divider', flexShrink: 0 }} />
      <Box
        component='i'
        className={running ? 'tabler-circle-check-filled' : failed ? 'tabler-circle-x-filled' : 'tabler-loader-2 animate-spin'}
        sx={{ fontSize: 22, color: `${tone}.main`, flexShrink: 0 }}
      />
      <Tooltip title={detail}>
        <Typography variant='body2' noWrap sx={{ flex: 1, minWidth: 0 }}>
          <Box component='span' sx={{ fontWeight: 600 }}>
            {headline}
          </Box>
          <Box component='span' sx={{ color: failed ? 'error.main' : 'text.secondary' }}>
            {' · '}
            {detail}
          </Box>
        </Typography>
      </Tooltip>
      <Chip
        size='small'
        variant='outlined'
        color={running ? 'success' : 'default'}
        icon={<i className='tabler-clock' style={{ fontSize: 14 }} />}
        label={`Updated at ${formatTime(state.printersCheckedAt)}`}
        sx={{ bgcolor: 'background.paper', flexShrink: 0 }}
      />
    </Paper>
  )
}

export default StatusCard
