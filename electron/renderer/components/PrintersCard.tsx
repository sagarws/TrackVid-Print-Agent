import { useState } from 'react'
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material'
import type { AgentPrinter } from '@shared/types/agent'
import SectionCard from './SectionCard'
import { matches } from '../utils/format'

type Feedback = { ok: boolean; message: string }

const PrintersCard = ({ printers, error, query }: { printers: AgentPrinter[]; error?: string; query: string }) => {
  const [refreshing, setRefreshing] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const shown = printers.filter(printer => matches(query, printer.displayName, printer.name))

  const refresh = async () => {
    setRefreshing(true)
    try {
      await window.printAgent.refreshPrinters()
    } finally {
      setRefreshing(false)
    }
  }

  const testPrint = async (printer: AgentPrinter) => {
    setTesting(printer.name)
    setFeedback(null)
    try {
      const result = await window.printAgent.testPrint(printer.name)
      setFeedback(result.ok ? { ok: true, message: `Test page sent to ${printer.displayName}.` } : { ok: false, message: result.error })
    } catch (err) {
      setFeedback({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(null)
    }
  }

  return (
    <SectionCard
      icon='tabler-printer'
      tone='secondary'
      title='Printers on this Computer'
      subtitle='Choose the label and invoice printer in TrackVid → Scan & Pack → Printers.'
      action={
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
          <Stack
            key={printer.name}
            direction='row'
            alignItems='center'
            spacing={2}
            sx={{ px: 3, py: 2.5, borderRadius: 2, bgcolor: 'action.hover' }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant='body2' sx={{ fontWeight: 600 }} noWrap>
                {printer.displayName}
              </Typography>
              <Typography variant='caption' color='text.secondary' noWrap component='p'>
                {printer.name}
              </Typography>
            </Box>
            <Stack alignItems='flex-end' spacing={0.5}>
              {printer.isDefault && (
                <Chip
                  size='small'
                  color='success'
                  variant='tonal'
                  icon={<i className='tabler-circle-check-filled' style={{ fontSize: 14 }} />}
                  label='Default'
                />
              )}
              <Button
                size='small'
                variant='text'
                disabled={testing !== null}
                onClick={() => void testPrint(printer)}
                sx={{ minWidth: 0, px: 1, fontSize: 12 }}
              >
                {testing === printer.name ? 'Sending…' : 'Test print'}
              </Button>
            </Stack>
          </Stack>
        ))}
      </Stack>
    </SectionCard>
  )
}

export default PrintersCard
