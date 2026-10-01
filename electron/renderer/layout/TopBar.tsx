import { useMemo, useState } from 'react'
import {
  Avatar,
  Badge,
  Box,
  ButtonBase,
  Divider,
  IconButton,
  InputAdornment,
  ListItemIcon,
  Menu,
  MenuItem,
  Popover,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import type { PrintJob } from '@shared/types/agent'
import { useAuth } from '../auth/AuthProvider'
import { userDisplayName } from '../auth/session'
import { formatShortTime } from '../utils/format'

interface Props {
  query: string
  onQueryChange: (value: string) => void
  jobs: PrintJob[]
  onOpenSettings: () => void
}

/**
 * Search, notifications and the local user. There is no sign-in: the agent
 * runs for whoever is at this computer, shown as "Trackvid User".
 */
const TopBar = ({ query, onQueryChange, jobs, onOpenSettings }: Props) => {
  const { user, logout } = useAuth()
  const displayName = userDisplayName(user)
  const initials =
    displayName
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase() ?? '')
      .join('') || 'TU'
  const [bellAnchor, setBellAnchor] = useState<HTMLElement | null>(null)
  const [userAnchor, setUserAnchor] = useState<HTMLElement | null>(null)
  // Failures the operator has not opened the bell on yet.
  const [seenFailures, setSeenFailures] = useState<ReadonlySet<string>>(() => new Set())

  const failures = useMemo(() => jobs.filter(job => job.status === 'failed'), [jobs])
  const unseen = failures.filter(job => !seenFailures.has(job.id)).length

  const openBell = (anchor: HTMLElement) => {
    setBellAnchor(anchor)
    setSeenFailures(new Set(failures.map(job => job.id)))
  }

  return (
    <Box
      component='header'
      sx={{
        height: 64,
        px: 5,
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        borderBlockEnd: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        position: 'sticky',
        top: 0,
        zIndex: 2
      }}
    >
      <TextField
        size='small'
        placeholder='Search printers and jobs…'
        value={query}
        onChange={event => onQueryChange(event.target.value)}
        sx={{ width: 320, '& .MuiOutlinedInput-root': { bgcolor: 'action.hover', borderRadius: 2 } }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position='start'>
                <i className='tabler-search' style={{ fontSize: 18 }} />
              </InputAdornment>
            ),
            endAdornment: query ? (
              <InputAdornment position='end'>
                <IconButton size='small' aria-label='Clear search' onClick={() => onQueryChange('')}>
                  <i className='tabler-x' style={{ fontSize: 16 }} />
                </IconButton>
              </InputAdornment>
            ) : undefined
          }
        }}
      />

      <Box sx={{ flex: 1 }} />

      <IconButton aria-label='Notifications' onClick={event => openBell(event.currentTarget)}>
        <Badge color='error' variant='dot' invisible={unseen === 0} overlap='circular'>
          <i className='tabler-bell' style={{ fontSize: 22 }} />
        </Badge>
      </IconButton>
      <Popover
        open={Boolean(bellAnchor)}
        anchorEl={bellAnchor}
        onClose={() => setBellAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 340, mt: 1 } } }}
      >
        <Box sx={{ px: 3, py: 2 }}>
          <Typography variant='subtitle1' sx={{ fontWeight: 600 }}>
            Notifications
          </Typography>
        </Box>
        <Divider />
        {failures.length === 0 ? (
          <Typography variant='body2' color='text.secondary' sx={{ px: 3, py: 3 }}>
            No failed print jobs. You'll see them here if a printer refuses one.
          </Typography>
        ) : (
          <Stack divider={<Divider />} sx={{ maxHeight: 320, overflow: 'auto' }}>
            {failures.slice(0, 10).map(job => (
              <Box key={job.id} sx={{ px: 3, py: 2 }}>
                <Stack direction='row' spacing={1} alignItems='center'>
                  <Box component='i' className='tabler-circle-x' sx={{ color: 'error.main', fontSize: 16 }} />
                  <Typography variant='body2' sx={{ fontWeight: 600 }} noWrap>
                    {job.name} failed
                  </Typography>
                </Stack>
                <Typography variant='caption' color='text.secondary' component='p'>
                  {formatShortTime(job.startedAt)} · {job.printer}
                </Typography>
                {job.error && (
                  <Typography variant='caption' color='error.main' component='p'>
                    {job.error}
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </Popover>

      <ButtonBase
        onClick={event => setUserAnchor(event.currentTarget)}
        sx={{ gap: 1.5, borderRadius: 2, px: 1, py: 0.5 }}
        aria-label='User menu'
      >
        <Avatar sx={{ width: 34, height: 34, fontSize: 13, fontWeight: 600, bgcolor: 'primary.main', color: '#fff' }}>
          {initials}
        </Avatar>
        <Typography variant='body2' sx={{ fontWeight: 600 }}>
          {displayName}
        </Typography>
        <i className='tabler-chevron-down' style={{ fontSize: 16 }} />
      </ButtonBase>
      <Menu
        open={Boolean(userAnchor)}
        anchorEl={userAnchor}
        onClose={() => setUserAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ px: 3, py: 1.5 }}>
          <Typography variant='body2' sx={{ fontWeight: 600 }}>
            {displayName}
          </Typography>
          <Typography variant='caption' color='text.secondary'>
            {user?.email ?? ''}
          </Typography>
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            setUserAnchor(null)
            onOpenSettings()
          }}
        >
          <ListItemIcon>
            <i className='tabler-settings' style={{ fontSize: 18 }} />
          </ListItemIcon>
          Settings
        </MenuItem>
        <MenuItem
          onClick={() => {
            setUserAnchor(null)
            void logout()
          }}
        >
          <ListItemIcon>
            <i className='tabler-logout' style={{ fontSize: 18 }} />
          </ListItemIcon>
          Log out
        </MenuItem>
      </Menu>
    </Box>
  )
}

export default TopBar
