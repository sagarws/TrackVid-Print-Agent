/**
 * The logged-in session, kept the way the web admin keeps it (TrackVid-FE
 * LocalStorageService): the access token and the user, under the same keys.
 */
const TOKEN_KEY = 'user-token'
const USER_KEY = 'user-details'

export { userDisplayName, type SessionUser } from '@shared/utils/userName'
import type { SessionUser } from '@shared/utils/userName'

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    // Storage unavailable: behave as logged out rather than crash.
    return null
  }
}

export const getToken = (): string | null => read(TOKEN_KEY)

export const getUser = (): SessionUser | null => {
  const raw = read(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SessionUser
  } catch {
    // A corrupt entry is treated as no user; the next login rewrites it.
    return null
  }
}

export const saveSession = (token: string, user: SessionUser): void => {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export const clearSession = (): void => {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch {
    // Nothing stored that could be removed.
  }
}

/**
 * When the token stops being valid, from its JWT `exp` (ms since epoch), or
 * null if it carries none. Only read to log out on time — the server is still
 * what decides (any 401 logs out too).
 */
export const tokenExpiresAt = (token: string): number | null => {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown }
    return typeof json.exp === 'number' ? json.exp * 1000 : null
  } catch {
    return null
  }
}
