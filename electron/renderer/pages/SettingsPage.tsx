import { useState } from 'react'
import { Alert, Box, ButtonBase, Stack, Switch, Typography } from '@mui/material'
import type { AgentState, Result, ThemeMode } from '@shared/types/agent'
import { useSettings } from '@core/hooks/useSettings'
import SectionCard from '../components/SectionCard'
import ScanPackStorageCard from '../components/ScanPackStorageCard'
import { platformLabel } from '../utils/format'

const MODES: { id: ThemeMode; label: string; hint: string; icon: string }[] = [
  { id: 'light', label: 'Day', hint: 'Light background', icon: 'tabler-sun' },
  { id: 'dark', label: 'Night', hint: 'Dark background', icon: 'tabler-moon' },
  { id: 'system', label: 'System', hint: 'Follow this computer', icon: 'tabler-device-desktop' }
]

const Row = ({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) => (
  <Stack direction='row' alignItems='center' spacing={3} sx={{ py: 1 }}>
    <Box sx={{ flex: 1 }}>
      <Typography variant='body2' sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      <Typography variant='caption' color='text.secondary'>
        {hint}
      </Typography>
    </Box>
    {children}
  </Stack>
)

const SettingsPage = ({ state }: { state: AgentState }) => {
  const { settings, updateSettings } = useSettings()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const devRun = !state.packaged

  const toggle = async (action: () => Promise<Result>) => {
    setSaving(true)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) setError(result.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack spacing={4} sx={{ maxWidth: 820, mx: 'auto' }}>
      <Box>
        <Typography variant='h4' sx={{ fontSize: 24, fontWeight: 700 }}>
          Settings
        </Typography>
        <Typography color='text.secondary' sx={{ fontSize: 14, mt: 0.5 }}>
          How the agent looks, starts and prints on this computer.
        </Typography>
      </Box>

      <SectionCard icon='tabler-sun' tone='warning' title='Theme' subtitle='Day or night mode for this window.'>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
          {MODES.map(mode => {
            const selected = (settings.mode ?? 'system') === mode.id
            return (
              <ButtonBase
                key={mode.id}
                onClick={() => updateSettings({ mode: mode.id })}
                aria-pressed={selected}
                sx={{
                  p: 3,
                  borderRadius: 2,
                  border: '1.5px solid',
                  borderColor: selected ? 'primary.main' : 'divider',
                  bgcolor: selected ? 'var(--mui-palette-primary-lighterOpacity)' : 'transparent',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 1.5,
                  textAlign: 'start'
                }}
              >
                <Box
                  component='i'
                  className={mode.icon}
                  sx={{ fontSize: 24, color: selected ? 'primary.main' : 'text.secondary' }}
                />
                <Box>
                  <Typography variant='body2' sx={{ fontWeight: 600 }}>
                    {mode.label}
                  </Typography>
                  <Typography variant='caption' color='text.secondary'>
                    {mode.hint}
                  </Typography>
                </Box>
              </ButtonBase>
            )
          })}
        </Box>
      </SectionCard>

      <SectionCard icon='tabler-power' tone='success' title='Startup' subtitle='Printing only works while the agent is running.'>
        <Row
          title='Start when I log in'
          hint={devRun ? 'Only available in the installed app.' : 'Recommended. Starts quietly in the background.'}
        >
          <Switch
            checked={state.openAtLogin}
            disabled={saving || devRun}
            onChange={event => void toggle(() => window.printAgent.setOpenAtLogin(event.target.checked))}
            slotProps={{ input: { 'aria-label': 'Start when I log in' } }}
          />
        </Row>
      </SectionCard>

      <SectionCard
        icon='tabler-printer'
        tone='primary'
        title='Printing'
        subtitle='What the agent does when a printer is not ready.'
      >
        <Row
          title='Refuse jobs for offline or paused printers'
          hint='Recommended. TrackVid shows the problem straight away, instead of the job waiting in a queue and printing hours later.'
        >
          <Switch
            checked={state.blockOfflinePrinters}
            disabled={saving}
            onChange={event => void toggle(() => window.printAgent.setBlockOfflinePrinters(event.target.checked))}
            slotProps={{ input: { 'aria-label': 'Refuse jobs for offline or paused printers' } }}
          />
        </Row>
        <Row
          title='Notify me about printer problems'
          hint='A desktop notification when a printer in use goes offline, runs out of paper, or a job fails.'
        >
          <Switch
            checked={state.notifications}
            disabled={saving}
            onChange={event => void toggle(() => window.printAgent.setNotifications(event.target.checked))}
            slotProps={{ input: { 'aria-label': 'Notify me about printer problems' } }}
          />
        </Row>
      </SectionCard>
      {error && <Alert severity='error'>{error}</Alert>}

      <ScanPackStorageCard scanPack={state.scanPack} />

      <SectionCard icon='tabler-info-circle' tone='primary' title='About'>
        <Stack spacing={1.5}>
          <Row title='Version' hint={`TrackVid Print Agent on ${platformLabel(state.platform)}`}>
            <Typography variant='body2'>{state.version}</Typography>
          </Row>
          <Row
            title='Local address'
            hint='Where TrackVid sends print jobs. Only this computer can reach it.'
          >
            <Typography variant='body2' sx={{ fontFamily: 'monospace' }}>
              {state.server.state === 'listening' ? `${state.server.host}:${state.server.port}` : '—'}
            </Typography>
          </Row>
          {state.logPath && (
            <Row title='Log file' hint={state.logPath}>
              <span />
            </Row>
          )}
        </Stack>
      </SectionCard>
    </Stack>
  )
}

export default SettingsPage
