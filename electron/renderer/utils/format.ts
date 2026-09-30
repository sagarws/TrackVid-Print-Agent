export const formatTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—'

export const formatShortTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export const platformLabel = (platform: 'darwin' | 'win32' | 'linux'): string =>
  platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux'

/** Case-insensitive "does any of these contain the query". Empty query matches all. */
export const matches = (query: string, ...fields: (string | undefined)[]): boolean => {
  const needle = query.trim().toLowerCase()
  return !needle || fields.some(field => field?.toLowerCase().includes(needle))
}
