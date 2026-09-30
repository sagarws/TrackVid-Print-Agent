import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import type { AgentState } from '@shared/types/agent'
import { SIDEBAR } from '../theme/brand'
import logo from '../assets/logo.svg'

export type Page = 'home' | 'scanpack' | 'background' | 'settings'

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'tabler-smart-home' },
  { id: 'scanpack', label: 'Scan and Pack', icon: 'tabler-barcode' },
  { id: 'background', label: 'Background process', icon: 'tabler-stack-2' },
  { id: 'settings', label: 'Settings', icon: 'tabler-settings' }
]

const Sidebar = ({ page, onNavigate, state }: { page: Page; onNavigate: (page: Page) => void; state: AgentState }) => {
  const online = state.server.state === 'listening'
  const starting = state.server.state === 'starting'

  return (
    <Box
      component='aside'
      sx={theme => ({
        width: SIDEBAR.width,
        flexShrink: 0,
        bgcolor: SIDEBAR.bg,
        color: SIDEBAR.text,
        display: 'flex',
        flexDirection: 'column',
        px: 3,
        py: 4,
        position: 'sticky',
        top: 0,
        height: '100vh',
        ...theme.applyStyles('dark', { bgcolor: SIDEBAR.bgDark, borderInlineEnd: `1px solid ${SIDEBAR.panelBorder}` })
      })}
    >
      <Stack direction='row' spacing={1.5} alignItems='center' sx={{ px: 1.5, mb: 6 }}>
        <Box component='img' src={logo} alt='' sx={{ width: 34, height: 28 }} />
        <Typography sx={{ color: '#fff', fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>TrackVid</Typography>
      </Stack>

      <Stack component='nav' spacing={1} aria-label='Main'>
        {NAV.map(item => {
          const active = item.id === page
          return (
            <ButtonBase
              key={item.id}
              onClick={() => onNavigate(item.id)}
              aria-current={active ? 'page' : undefined}
              sx={{
                justifyContent: 'flex-start',
                gap: 2,
                px: 2,
                py: 1.5,
                borderRadius: 2,
                fontSize: 14,
                fontWeight: active ? 600 : 500,
                color: active ? '#fff' : SIDEBAR.text,
                bgcolor: active ? 'primary.main' : 'transparent',
                boxShadow: active ? '0 6px 16px -6px rgb(var(--mui-palette-primary-mainChannel) / 0.7)' : 'none',
                '&:hover': { bgcolor: active ? 'primary.main' : SIDEBAR.hover }
              }}
            >
              <i className={item.icon} style={{ fontSize: 20 }} />
              {item.label}
            </ButtonBase>
          )
        })}
      </Stack>

      <Box sx={{ flex: 1 }} />

      <Box
        sx={{
          p: 2.5,
          borderRadius: 2,
          bgcolor: SIDEBAR.panel,
          border: `1px solid ${SIDEBAR.panelBorder}`,
          mb: 4
        }}
      >
        <Stack direction='row' spacing={1.5} alignItems='center'>
          <Box
            sx={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              flexShrink: 0,
              bgcolor: online ? 'success.main' : starting ? 'warning.main' : 'error.main',
              boxShadow: theme =>
                `0 0 0 3px ${online ? theme.vars?.palette.success.lightOpacity : theme.vars?.palette.error.lightOpacity}`
            }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
              {online ? 'System Online' : starting ? 'Starting…' : 'Agent Offline'}
            </Typography>
            <Typography sx={{ color: SIDEBAR.textMuted, fontSize: 11.5 }}>
              {online ? 'All services are running' : starting ? 'Opening the print service' : 'Printing is unavailable'}
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Typography sx={{ color: SIDEBAR.textMuted, fontSize: 12, px: 1.5 }}>v{state.version}</Typography>
    </Box>
  )
}

export default Sidebar
