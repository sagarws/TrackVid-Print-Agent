import { app } from 'electron'
import { ALLOWED_ORIGINS } from '@shared/constants/agent'
import type { AgentPrinter, AgentState, PrintJob, ServerStatus } from '@shared/types/agent'
import { logger } from './logger'
import { getLastCleanup } from './scanpack/retention'
import { storageRoot } from './scanpack/store'
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

/**
 * Origins trusted right now: the built-in list, plus any site added through
 * the Allowed Websites card of an earlier version (still in settings.json, so
 * an upgrade never takes access away).
 */
export const allowedOrigins = (): string[] => [...ALLOWED_ORIGINS, ...getSettings().allowedOrigins]

export const snapshot = (): AgentState => {
  const platform = process.platform
  return {
    version: app.getVersion(),
    platform: platform === 'darwin' || platform === 'win32' ? platform : 'linux',
    server,
    printers,
    ...(printersError ? { printersError } : {}),
    printersCheckedAt,
    packaged: app.isPackaged,
    scanPack: {
      dir: storageRoot(),
      isDefaultDir: getSettings().scanPackDir === null,
      weeksKept: getSettings().scanPackWeeksKept,
      lastCleanup: getLastCleanup(),
      workers: getSettings().scanPackWorkers
    },
    openAtLogin: getSettings().openAtLogin,
    themeMode: getSettings().themeMode,
    blockOfflinePrinters: getSettings().blockOfflinePrinters,
    notifications: getSettings().notifications,
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

export const getJobs = (): PrintJob[] => jobs

export const setJobs = (next: PrintJob[]): void => {
  jobs = next
  notify()
}
