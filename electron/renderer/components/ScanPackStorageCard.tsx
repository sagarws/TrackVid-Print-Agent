import { useEffect, useState } from 'react'
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import type { ScanPackSettingsState } from '@shared/types/scanpack'
import { MAX_WEEKS_KEPT, MIN_WEEKS_KEPT } from '@shared/utils/weekFolder'
import SectionCard from './SectionCard'

const WEEK_OPTIONS = Array.from({ length: MAX_WEEKS_KEPT - MIN_WEEKS_KEPT + 1 }, (_, i) => i + MIN_WEEKS_KEPT)

const describe = (weeks: number) =>
  weeks === 1 ? 'This week only' : weeks === 2 ? 'This week + last week' : `This week + the ${weeks - 1} weeks before it`

type Feedback = { ok: boolean; message: string }

/**
 * Where Scan & Pack keeps its PDFs and how long it keeps them — the local
 * version of the backend's Google Drive week folders and retention cron.
 */
const ScanPackStorageCard = ({ scanPack }: { scanPack: ScanPackSettingsState }) => {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  // Success messages clear themselves; errors stay until dismissed.
  useEffect(() => {
    if (!feedback?.ok) return
    const timer = window.setTimeout(() => setFeedback(null), 5000)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const run = async <T,>(
    call: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>,
    success: (value: T) => string | null
  ) => {
    setBusy(true)
    setFeedback(null)
    try {
      const result = await call()
      if (!result.ok) setFeedback({ ok: false, message: result.error })
      else {
        const message = success(result.value)
        if (message) setFeedback({ ok: true, message })
      }
    } catch (err) {
      setFeedback({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const cleanupText = (s: { packlogsDeleted: number; filesDeleted: number; foldersDeleted: number; failed: number }) =>
    s.packlogsDeleted || s.filesDeleted || s.foldersDeleted
      ? `Removed ${s.packlogsDeleted} packlog(s), ${s.filesDeleted} file(s) and ${s.foldersDeleted} week folder(s).${s.failed ? ` ${s.failed} could not be removed.` : ''}`
      : 'Nothing older than the kept weeks — nothing to remove.'

  const last = scanPack.lastCleanup

  return (
    <SectionCard
      icon='tabler-folder-open'
      tone='primary'
      title='Scan & Pack storage'
      subtitle='Where packlog PDFs are saved, and how many weeks are kept.'
    >
      <Stack spacing={3}>
        {feedback && (
          <Alert severity={feedback.ok ? 'success' : 'error'} onClose={() => setFeedback(null)}>
            {feedback.message}
          </Alert>
        )}

        <Box>
          <Typography variant='body2' sx={{ fontWeight: 600 }}>
            Save files in
          </Typography>
          <Typography variant='caption' color='text.secondary' component='p'>
            Each packlog's PDFs go in <code>scan-and-pack/&lt;week&gt;/</code> inside this folder
            {scanPack.isDefaultDir ? ' (your Downloads folder, the default).' : '.'}
          </Typography>
          <Box
            sx={{
              mt: 1.5,
              px: 2,
              py: 1.25,
              borderRadius: 1.5,
              bgcolor: 'action.hover',
              fontFamily: 'monospace',
              fontSize: 12.5,
              wordBreak: 'break-all'
            }}
          >
            {scanPack.dir}
          </Box>
          <Stack direction='row' spacing={1.5} sx={{ mt: 1.5 }} flexWrap='wrap' useFlexGap>
            <Button
              size='small'
              variant='contained'
              disabled={busy}
              startIcon={<i className='tabler-folder-open' style={{ fontSize: 16 }} />}
              onClick={() =>
                void run(
                  () => window.printAgent.scanPack.chooseDir(),
                  picked => (picked ? 'New packlogs will be saved in the chosen folder.' : null)
                )
              }
            >
              Choose folder…
            </Button>
            <Button size='small' variant='outlined' disabled={busy} onClick={() => void run(() => window.printAgent.scanPack.openDir(), () => null)}>
              Open folder
            </Button>
            {!scanPack.isDefaultDir && (
              <Button
                size='small'
                variant='text'
                disabled={busy}
                onClick={() => void run(() => window.printAgent.scanPack.resetDir(), () => 'Back to the Downloads folder.')}
              >
                Use Downloads
              </Button>
            )}
          </Stack>
          <Typography variant='caption' color='text.secondary' component='p' sx={{ mt: 1 }}>
            Changing the folder applies to new packlogs. Existing ones keep their files where they were saved.
          </Typography>
        </Box>

        <Stack direction='row' alignItems='center' spacing={3}>
          <Box sx={{ flex: 1 }}>
            <Typography variant='body2' sx={{ fontWeight: 600 }}>
              Keep data for
            </Typography>
            <Typography variant='caption' color='text.secondary'>
              Weeks run Monday to Sunday. Older packlogs, their PDFs and their week folders are deleted automatically (checked
              every 6 hours).
            </Typography>
          </Box>
          <TextField
            select
            size='small'
            value={scanPack.weeksKept}
            disabled={busy}
            onChange={event =>
              void run(
                () => window.printAgent.scanPack.setWeeksKept(Number(event.target.value)),
                summary => `Now keeping ${describe(Number(event.target.value)).toLowerCase()}. ${cleanupText(summary)}`
              )
            }
            sx={{ minWidth: 260 }}
          >
            {WEEK_OPTIONS.map(weeks => (
              <MenuItem key={weeks} value={weeks}>
                {weeks} {weeks === 1 ? 'week' : 'weeks'} — {describe(weeks)}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <Stack direction='row' alignItems='center' spacing={3}>
          <Box sx={{ flex: 1 }}>
            <Typography variant='body2' sx={{ fontWeight: 600 }}>
              Last cleanup
            </Typography>
            <Typography variant='caption' color='text.secondary'>
              {last ? `${new Date(last.at).toLocaleString()} — ${cleanupText(last)}` : 'Not run yet.'}
            </Typography>
          </Box>
          <Button
            size='small'
            variant='outlined'
            disabled={busy}
            onClick={() => void run(() => window.printAgent.scanPack.runCleanup(), cleanupText)}
          >
            Clean up now
          </Button>
        </Stack>
      </Stack>
    </SectionCard>
  )
}

export default ScanPackStorageCard
