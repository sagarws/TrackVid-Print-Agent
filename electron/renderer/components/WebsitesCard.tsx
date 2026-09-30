import { useEffect, useState, type FormEvent } from 'react'
import { Alert, Box, Button, Chip, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material'
import { normaliseOrigin } from '@shared/utils/origin'
import SectionCard from './SectionCard'
import { matches } from '../utils/format'

/**
 * The websites allowed to send print jobs. Anything not on this list gets a
 * refusal from the agent, so a random site open in the same browser cannot
 * print on the packer's printers.
 */
const WebsitesCard = ({ allowed, devOrigins, query }: { allowed: string[]; devOrigins: string[]; query: string }) => {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  // "Copied" reverts after a moment.
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(null), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const rows = [
    ...allowed.map(origin => ({ origin, dev: false })),
    ...devOrigins.map(origin => ({ origin, dev: true }))
  ].filter(row => matches(query, row.origin))

  const save = async (next: string[]) => {
    setSaving(true)
    setError(null)
    try {
      const result = await window.printAgent.setAllowedOrigins(next)
      if (!result.ok) setError(result.error)
      return result.ok
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  const add = async (event: FormEvent) => {
    event.preventDefault()
    const origin = normaliseOrigin(draft)
    if (!origin) {
      setError('Enter just the website, like https://trackvid.in or https://*.trackvid.in — no page path.')
      return
    }
    if (allowed.includes(origin)) {
      setDraft('')
      return
    }
    if (await save([...allowed, origin])) setDraft('')
  }

  const copy = async (origin: string) => {
    try {
      await navigator.clipboard.writeText(origin)
      setCopied(origin)
    } catch (err) {
      setError(`Could not copy: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <SectionCard
      icon='tabler-world'
      title='Allowed Websites'
      subtitle='Only these websites can print through this agent. * allows every subdomain.'
    >
      <Stack spacing={3}>
        {error && (
          <Alert severity='error' onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {allowed.length === 0 && (
          <Alert severity='warning'>No websites are allowed, so nothing can print. Add TrackVid's address below.</Alert>
        )}
        {rows.length > 0 && (
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
            {rows.map(({ origin, dev }, index) => (
              <Stack
                key={origin}
                direction='row'
                alignItems='center'
                spacing={1}
                sx={{ px: 2.5, py: 1.25, borderBlockStart: index ? '1px solid' : 'none', borderColor: 'divider' }}
              >
                <Typography variant='body2' sx={{ flex: 1, minWidth: 0 }} noWrap>
                  {origin}
                </Typography>
                {dev && <Chip size='small' variant='tonal' color='info' label='Development only' />}
                <Tooltip title={copied === origin ? 'Copied' : 'Copy'}>
                  <IconButton size='small' aria-label={`Copy ${origin}`} onClick={() => void copy(origin)}>
                    <i className={copied === origin ? 'tabler-check' : 'tabler-copy'} style={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={dev ? 'Added automatically in a development run' : 'Remove'}>
                  <span>
                    <IconButton
                      size='small'
                      color='error'
                      disabled={saving || dev}
                      aria-label={`Remove ${origin}`}
                      onClick={() => void save(allowed.filter(entry => entry !== origin))}
                    >
                      <i className='tabler-trash' style={{ fontSize: 17 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            ))}
          </Box>
        )}
        {rows.length === 0 && query && (
          <Typography variant='body2' color='text.secondary'>
            No website matches "{query}".
          </Typography>
        )}
        <form onSubmit={event => void add(event)}>
          <Stack direction='row' spacing={2}>
            <TextField
              size='small'
              fullWidth
              placeholder='https://example.com'
              value={draft}
              onChange={event => setDraft(event.target.value)}
            />
            <Button type='submit' variant='contained' disabled={saving || !draft.trim()} sx={{ minWidth: 72 }}>
              Add
            </Button>
          </Stack>
        </form>
        <Stack direction='row' spacing={1} alignItems='center' sx={{ color: 'text.secondary' }}>
          <i className='tabler-info-circle' style={{ fontSize: 15 }} />
          <Typography variant='caption'>Changes apply immediately. No restart needed.</Typography>
        </Stack>
      </Stack>
    </SectionCard>
  )
}

export default WebsitesCard
