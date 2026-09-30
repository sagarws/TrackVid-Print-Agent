import { app } from 'electron'
import { DEV_ALLOWED_ORIGINS } from '@shared/constants/agent'
import type { AgentPrinter, AgentState, PrintJob, ServerStatus } from '@shared/types/agent'
import { logger } from './logger'
import { getSettings } from './settings'

/**
 * Everything the window shows, held in one place and pushed to it whole on
 * every change. The state is small (a printer list and the last hundred jobs),
 * so sending all of it is simpler than diffing and cannot drift.
 */
type Listener = (state: AgentState) => void

let server: ServerStatus = { state: 'starting' }
let printers: AgentPrinter[] = []
let printersError: string | undefined
let printersCheckedAt: string | null = null
let jobs: PrintJob[] = []
const listeners = new Set<Listener>()

/** Origins trusted right now: the saved list, plus the dev ones in a dev run. */
export const allowedOrigins = (): string[] =>
  app.isPackaged ? getSettings().allowedOrigins : [...getSettings().allowedOrigins, ...DEV_ALLOWED_ORIGINS]

export const snapshot = (): AgentState => {
  const platform = process.platform
  return {
    version: app.getVersion(),
    platform: platform === 'darwin' || platform === 'win32' ? platform : 'linux',
    server,
    printers,
    ...(printersError ? { printersError } : {}),
    printersCheckedAt,
    allowedOrigins: getSettings().allowedOrigins,
    devOrigins: app.isPackaged ? [] : [...DEV_ALLOWED_ORIGINS],
    openAtLogin: getSettings().openAtLogin,
    themeMode: getSettings().themeMode,
    logPath: logger.path(),
    jobs
  }
}

export const notify = (): void => {
  const state = snapshot()
  listeners.forEach(listener => listener(state))
}

export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const setServerStatus = (next: ServerStatus): void => {
  server = next
  notify()
}

export const setPrinters = (next: AgentPrinter[], error?: string): void => {
  printers = next
  printersError = error
  printersCheckedAt = new Date().toISOString()
  notify()
}

export const getPrinters = (): AgentPrinter[] => printers

export const setJobs = (next: PrintJob[]): void => {
  jobs = next
  notify()
}
