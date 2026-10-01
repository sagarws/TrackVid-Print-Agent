import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthService } from '../api/auth-service'
import { SESSION_EXPIRED_EVENT } from '../api/axios'
import { clearSession, getToken, getUser, saveSession, tokenExpiresAt, type SessionUser } from './session'

type AuthStatus = 'checking' | 'signed-in' | 'signed-out'

interface AuthContextValue {
  status: AuthStatus
  user: SessionUser | null
  /** Why the last session ended, for the login page ("Your session has expired."). */
  notice: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Longest a setTimeout can wait (~24.8 days); a later expiry is re-armed when it fires. */
const MAX_TIMER_MS = 2_147_483_647

/**
 * Login for the app, as in the web admin: the backend's `/auth/login` answers
 * with an access token and the user, kept as the session. It ends when
 *   - the user logs out (the server is told, so the token stops working),
 *   - any API call answers 401 (the API client clears the session and fires
 *     SESSION_EXPIRED_EVENT), or
 *   - the token's own expiry time passes — so an idle app does not keep
 *     showing a session the server would already refuse.
 */
const EXPIRED = 'Your session has expired. Please log in again.'

/** A stored session at start: still to check with the server, expired, or none. */
const initialSession = (): { status: AuthStatus; notice: string | null } => {
  const token = getToken()
  if (!token) return { status: 'signed-out', notice: null }
  const expiresAt = tokenExpiresAt(token)
  if (expiresAt !== null && expiresAt <= Date.now()) {
    clearSession()
    return { status: 'signed-out', notice: EXPIRED }
  }
  return { status: 'checking', notice: null }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [initial] = useState(initialSession)
  const [status, setStatus] = useState<AuthStatus>(initial.status)
  const [user, setUser] = useState<SessionUser | null>(() => (initial.status === 'checking' ? getUser() : null))
  const [notice, setNotice] = useState<string | null>(initial.notice)

  const endSession = useCallback((reason: string | null) => {
    clearSession()
    setUser(null)
    setNotice(reason)
    setStatus('signed-out')
  }, [])

  // A stored session is checked with the server once at start. Unreachable
  // server: keep it (the web admin does the same) — the next call that gets
  // a 401 ends it.
  useEffect(() => {
    if (status !== 'checking') return
    let active = true
    AuthService.getUser()
      .then(() => {
        if (active) setStatus('signed-in')
      })
      .catch(() => {
        // A 401 has already ended the session via the event; anything else
        // (offline) keeps it.
        if (active && getToken()) setStatus('signed-in')
      })
    return () => {
      active = false
    }
  }, [status])

  // Any API call answering 401 ends the session, from anywhere in the app.
  useEffect(() => {
    const onExpired = () => endSession(EXPIRED)
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [endSession])

  // Log out when the token itself expires.
  useEffect(() => {
    if (status !== 'signed-in') return
    const token = getToken()
    const expiresAt = token ? tokenExpiresAt(token) : null
    if (expiresAt === null) return
    const wait = expiresAt - Date.now()
    const timer = window.setTimeout(
      () => {
        if ((tokenExpiresAt(getToken() ?? '') ?? Infinity) <= Date.now()) {
          endSession(EXPIRED)
        } else {
          // Re-arm (the wait was capped, or the token was replaced).
          setStatus('checking')
        }
      },
      Math.min(Math.max(wait, 0), MAX_TIMER_MS)
    )
    return () => window.clearTimeout(timer)
  }, [status, endSession])

  const login = useCallback(async (email: string, password: string) => {
    const response = await AuthService.login({ email, password })
    const { isSuccess, data, displayMessage } = response.data
    if (!isSuccess || !data?.accessToken) throw new Error(displayMessage || 'Login failed.')
    saveSession(data.accessToken, data.user)
    setUser(data.user)
    setNotice(null)
    setStatus('signed-in')
  }, [])

  const logout = useCallback(async () => {
    try {
      await AuthService.logout()
    } catch {
      // Logging out locally must not depend on the server answering; the
      // token then simply runs out at its expiry.
    }
    endSession(null)
  }, [endSession])

  const value = useMemo(() => ({ status, user, notice, login, logout }), [status, user, notice, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
