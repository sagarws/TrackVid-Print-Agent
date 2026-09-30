import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { ThemeMode } from '@shared/types/agent'
import { normaliseOrigin } from '@shared/utils/origin'
import { clampWeeks, clampWorkers, DEFAULT_EXTRACT_WORKERS, DEFAULT_WEEKS_KEPT } from '@shared/utils/weekFolder'
import { logger } from './logger'

/**
 * The agent's own settings, as JSON in the OS app-data folder. Printer
 * assignment is NOT here: which printer gets labels and which gets invoices is
 * chosen in the web app's Printer Setup, per browser.
 */
export interface AgentSettings {
  allowedOrigins: string[]
  openAtLogin: boolean
  themeMode: ThemeMode
  /** Refuse a job for a printer that is offline or paused, instead of queueing it. */
  blockOfflinePrinters: boolean
  /** Desktop notifications when a printer needs attention or a job fails. */
  notifications: boolean
  /** Where Scan & Pack writes its PDFs. null = the OS Downloads folder. */
  scanPackDir: string | null
  /** Weeks of Scan & Pack data kept: this week plus N-1 before it. */
  scanPackWeeksKept: number
  /** Utility processes cutting per-order PDFs in parallel after an upload. */
  scanPackWorkers: number
}

const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system']

const defaults = (): AgentSettings => ({
  // Extra sites saved by an earlier version. The built-in list is in
  // shared/constants/agent.ts (ALLOWED_ORIGINS) and is not stored.
  allowedOrigins: [],
  // Only a packaged install registers itself; a dev run must not leave a login
  // item pointing at node_modules/electron behind.
  openAtLogin: app.isPackaged,
  themeMode: 'system',
  blockOfflinePrinters: true,
  notifications: true,
  scanPackDir: null,
  scanPackWeeksKept: DEFAULT_WEEKS_KEPT,
  scanPackWorkers: DEFAULT_EXTRACT_WORKERS
})

let cached: AgentSettings | null = null

const filePath = (): string => join(app.getPath('userData'), 'settings.json')

const sanitise = (raw: unknown): AgentSettings => {
  const base = defaults()
  if (!raw || typeof raw !== 'object') return base
  const value = raw as Partial<Record<keyof AgentSettings, unknown>>

  const origins = Array.isArray(value.allowedOrigins)
    ? value.allowedOrigins
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => normaliseOrigin(entry))
        .filter((entry): entry is string => entry !== null)
    : base.allowedOrigins

  return {
    allowedOrigins: Array.from(new Set(origins)),
    openAtLogin: typeof value.openAtLogin === 'boolean' ? value.openAtLogin : base.openAtLogin,
    themeMode: THEME_MODES.includes(value.themeMode as ThemeMode) ? (value.themeMode as ThemeMode) : base.themeMode,
    blockOfflinePrinters:
      typeof value.blockOfflinePrinters === 'boolean' ? value.blockOfflinePrinters : base.blockOfflinePrinters,
    notifications: typeof value.notifications === 'boolean' ? value.notifications : base.notifications,
    scanPackDir: typeof value.scanPackDir === 'string' && value.scanPackDir.trim() ? value.scanPackDir : null,
    scanPackWeeksKept:
      typeof value.scanPackWeeksKept === 'number' ? clampWeeks(value.scanPackWeeksKept) : base.scanPackWeeksKept,
    scanPackWorkers:
      typeof value.scanPackWorkers === 'number' ? clampWorkers(value.scanPackWorkers) : base.scanPackWorkers
  }
}

export const getSettings = (): AgentSettings => {
  if (cached) return cached
  try {
    cached = sanitise(JSON.parse(readFileSync(filePath(), 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('settings.json unreadable, using defaults', error)
    }
    cached = defaults()
  }
  return cached
}

export const updateSettings = (patch: Partial<AgentSettings>): AgentSettings => {
  const next = sanitise({ ...getSettings(), ...patch })
  const path = filePath()
  mkdirSync(dirname(path), { recursive: true })
  // Write-then-rename, so a crash mid-write cannot leave half a file behind.
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(next, null, 2))
  renameSync(temp, path)
  cached = next
  return next
}
