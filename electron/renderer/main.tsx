import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Alert, Box, CircularProgress } from '@mui/material'
import { SettingsProvider, type Settings } from '@core/contexts/settingsContext'
import type { AgentState } from '@shared/types/agent'
import { VuexyThemeProvider } from './theme/VuexyThemeProvider'
import { BRAND_PRIMARY } from './theme/brand'
import App from './App'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import LoginPage from './pages/LoginPage'
import ErrorBoundary from './components/ErrorBoundary'
import { appLog } from './utils/appLog'
import './styles/app.css'

// Anything thrown outside React's render (event handlers, timers, promises).
window.addEventListener('error', event => {
  appLog('error', 'uncaught', `${event.message} at ${event.filename}:${event.lineno}:${event.colno}\n${(event.error as Error | undefined)?.stack ?? ''}`)
})
window.addEventListener('unhandledrejection', event => {
  const reason = event.reason as unknown
  appLog('error', 'unhandled-promise', reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason))
})

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root is missing from index.html')

// What the OS is in right now, so the first frame is not the wrong scheme.
const systemMode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

type Load = { status: 'loading' } | { status: 'ready'; state: AgentState } | { status: 'error'; message: string }

/**
 * Reads the agent's state before mounting the theme, because the saved
 * light/dark/system choice lives in the main process and the first frame
 * should already be in it.
 */
const Root = () => {
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    let active = true
    // Subscribe before the first read so a change landing in between is not lost.
    const unsubscribe = window.printAgent.onState(state => {
      if (active) setLoad({ status: 'ready', state })
    })
    window.printAgent
      .getState()
      .then(state => {
        if (!active) return
        setLoad(state ? { status: 'ready', state } : { status: 'error', message: 'The agent refused this window.' })
      })
      .catch((error: unknown) => {
        if (active) setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  if (load.status !== 'ready') {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 6 }}>
        {load.status === 'loading' ? (
          <CircularProgress size={28} />
        ) : (
          <Alert severity='error'>Could not read the agent's state: {load.message}</Alert>
        )}
      </Box>
    )
  }

  return <Themed state={load.state} />
}

/** Login page, a spinner while a stored session is checked, or the app. */
const AuthGate = ({ state }: { state: AgentState }) => {
  const { status } = useAuth()
  if (status === 'checking') {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={28} />
      </Box>
    )
  }
  return status === 'signed-in' ? <App state={state} /> : <LoginPage />
}

/**
 * Mounted once the state is known. The saved mode seeds the theme on mount
 * only; after that the theme owns it and every change is written back.
 */
const Themed = ({ state }: { state: AgentState }) => {
  const [stored] = useState<Settings>(() => ({ mode: state.themeMode, primaryColor: BRAND_PRIMARY }))
  const persist = useCallback((settings: Settings) => {
    if (settings.mode) void window.printAgent.setThemeMode(settings.mode)
  }, [])

  return (
    <SettingsProvider storedSettings={stored} onPersist={persist}>
      <VuexyThemeProvider systemMode={systemMode}>
        {/* Login gate: the app only for a signed-in TrackVid user. */}
        <ErrorBoundary>
          <AuthProvider>
            <AuthGate state={state} />
          </AuthProvider>
        </ErrorBoundary>
      </VuexyThemeProvider>
    </SettingsProvider>
  )
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
