/**
 * The user from the login response. `name` is TrackVid-BE's User.name, an
 * object `{ firstName, lastName, fullName }` — typed loosely, because older
 * or other accounts may send a plain string or nothing at all.
 */
export interface SessionUser {
  id: string
  email: string
  name?: string | { firstName?: string; lastName?: string; fullName?: string } | null
  companyId?: string | null
}

/** A name to show for the user, whatever shape `name` came in. */
export const userDisplayName = (user: SessionUser | null | undefined): string => {
  const name = user?.name
  if (typeof name === 'string' && name.trim()) return name.trim()
  if (name && typeof name === 'object') {
    const full = typeof name.fullName === 'string' ? name.fullName.trim() : ''
    if (full) return full
    const parts = [name.firstName, name.lastName].filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    if (parts.length) return parts.join(' ').trim()
  }
  return typeof user?.email === 'string' && user.email ? user.email : 'TrackVid user'
}
