import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * A plain append-only log in the OS log folder, so a packer's "it didn't
 * print" can be answered from the machine afterwards:
 *   macOS    ~/Library/Logs/TrackVid Print Agent/agent.log
 *   Windows  %APPDATA%\TrackVid Print Agent\logs\agent.log
 *
 * Rolled once at 5 MB to agent.old.log — two files, never more.
 */
const MAX_BYTES = 5 * 1024 * 1024

let file: string | null = null

const target = (): string | null => {
  if (file) return file
  try {
    const dir = app.getPath('logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'agent.log')
  } catch (error) {
    console.error('[logger] no log folder, logging to the console only', error)
  }
  return file
}

const write = (level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void => {
  const extra =
    detail === undefined ? '' : ` ${detail instanceof Error ? (detail.stack ?? detail.message) : JSON.stringify(detail)}`
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${extra}\n`

  if (level !== 'info') console.error(line.trimEnd())

  const path = target()
  if (!path) return
  try {
    try {
      if (statSync(path).size > MAX_BYTES) renameSync(path, path.replace(/\.log$/, '.old.log'))
    } catch {
      // No file yet — nothing to roll.
    }
    appendFileSync(path, line)
  } catch (error) {
    console.error('[logger] could not write the log file', error)
  }
}

export const logger = {
  info: (message: string, detail?: unknown) => write('info', message, detail),
  warn: (message: string, detail?: unknown) => write('warn', message, detail),
  error: (message: string, detail?: unknown) => write('error', message, detail),
  path: (): string | null => target()
}
