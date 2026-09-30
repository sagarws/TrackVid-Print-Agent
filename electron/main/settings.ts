import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_ALLOWED_ORIGINS } from '@shared/constants/agent'
import type { ThemeMode } from '@shared/types/agent'
import { normaliseOrigin } from '@shared/utils/origin'
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
}

const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system']

const defaults = (): AgentSettings => ({
  allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS],
  // Only a packaged install registers itself; a dev run must not leave a login
  // item pointing at node_modules/electron behind.
  openAtLogin: app.isPackaged,
  themeMode: 'system',
  blockOfflinePrinters: true,
  notifications: true
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
    notifications: typeof value.notifications === 'boolean' ? value.notifications : base.notifications
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
