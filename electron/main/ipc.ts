import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/constants/channels'
import type { AgentState, Result } from '@shared/types/agent'
import { cancelJob, releaseJob, reprintJob, submitJob } from './jobs'
import { applyOpenAtLogin } from './loginItem'
import { logger } from './logger'
import { cancelQueueJob, clearPrinterQueue, findPrinter, refreshPrinters, releaseQueueJob, resumePrinter } from './printers'
import { buildTestPdf } from './print/testPage'
import { updateSettings } from './settings'
import { notify, snapshot } from './state'
import { isRendererUrl } from './window'

/** Every handler refuses a caller that is not this app's own page. */
const fromRenderer = (event: IpcMainInvokeEvent): boolean => {
  const url = event.senderFrame?.url ?? ''
  if (isRendererUrl(url)) return true
  logger.warn('Refused IPC from an unexpected frame', { url })
  return false
}

const refused = { ok: false, error: 'Not allowed.' } as const

/** Run an action for the window and turn a thrown error into a Result. */
const attempt = async (action: () => Promise<unknown>): Promise<Result> => {
  try {
    await action()
    return { ok: true, value: undefined }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const isName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length < 512

const PRINTER_SETTINGS_URL: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'x-apple.systempreferences:com.apple.Print-Scan-Settings.extension',
  win32: 'ms-settings:printers'
}

export const setOpenAtLogin = (enabled: boolean): void => {
  updateSettings({ openAtLogin: enabled })
  applyOpenAtLogin(enabled)
  notify()
}

export const registerIpc = (): void => {
  // Log lines from the window: API calls, render crashes, uncaught errors.
  ipcMain.on(IPC.log, (event, level: unknown, scope: unknown, message: unknown) => {
    if (!isRendererUrl(event.senderFrame?.url ?? '')) return
    const text = `[window:${String(scope).slice(0, 40)}] ${String(message).slice(0, 4000)}`
    // stdout too, so it shows in the terminal running the app (npm run dev).
    process.stdout.write(`${text}\n`)
    if (level === 'error') logger.error(text)
    else if (level === 'warn') logger.warn(text)
    else logger.info(text)
  })

  ipcMain.handle(IPC.getState, (event): AgentState | null => (fromRenderer(event) ? snapshot() : null))

  ipcMain.handle(IPC.refreshPrinters, async (event): Promise<Result> => {
    if (!fromRenderer(event)) return refused
    await refreshPrinters()
    return { ok: true, value: undefined }
  })

  ipcMain.handle(IPC.testPrint, async (event, printer: unknown): Promise<Result> => {
    if (!fromRenderer(event)) return refused
    if (typeof printer !== 'string' || !(await findPrinter(printer))) {
      return { ok: false, error: 'That printer is no longer installed.' }
    }
    const job = await submitJob({
      bytes: buildTestPdf(printer, new Date()),
      printer,
      name: 'TrackVid test page',
      source: 'Test print',
      format: 'pdf'
    })
    return job.status === 'failed' ? { ok: false, error: job.error ?? 'Print failed.' } : { ok: true, value: undefined }
  })

  ipcMain.handle(IPC.resumePrinter, (event, printer: unknown): Promise<Result> | Result => {
    if (!fromRenderer(event)) return refused
    if (!isName(printer)) return { ok: false, error: 'Unknown printer.' }
    return attempt(() => resumePrinter(printer))
  })

  ipcMain.handle(IPC.clearQueue, (event, printer: unknown): Promise<Result> | Result => {
    if (!fromRenderer(event)) return refused
    if (!isName(printer)) return { ok: false, error: 'Unknown printer.' }
    return attempt(() => clearPrinterQueue(printer))
  })

  ipcMain.handle(IPC.cancelQueueJob, (event, printer: unknown, osJobId: unknown): Promise<Result> | Result => {
    if (!fromRenderer(event)) return refused
    if (!isName(printer) || typeof osJobId !== 'string' || !/^\d+$/.test(osJobId)) return { ok: false, error: 'Unknown job.' }
    return attempt(() => cancelQueueJob(printer, osJobId))
  })

  ipcMain.handle(IPC.releaseQueueJob, (event, printer: unknown, osJobId: unknown): Promise<Result> | Result => {
    if (!fromRenderer(event)) return refused
    if (!isName(printer) || typeof osJobId !== 'string' || !/^\d+$/.test(osJobId)) return { ok: false, error: 'Unknown job.' }
    return attempt(() => releaseQueueJob(printer, osJobId))
  })

  ipcMain.handle(IPC.cancelJob, (event, id: unknown): Promise<Result> | Result => {
    if (!fromRenderer(event)) return refused
    if (!isName(id)) return { ok: false, error: 'Unknown job.' }
    return attempt(() => cancelJob(id))
  })

  ipcMain.handle(IPC.releaseJob, (event, id: unknown): Promise<Result> | Result => {
    if (!fromRenderer(event)) return refused
    if (!isName(id)) return { ok: false, error: 'Unknown job.' }
    return attempt(() => releaseJob(id))
  })

  ipcMain.handle(IPC.reprintJob, async (event, id: unknown): Promise<Result> => {
    if (!fromRenderer(event)) return refused
    if (!isName(id)) return { ok: false, error: 'Unknown job.' }
    try {
      const job = await reprintJob(id)
      return job.status === 'failed' ? { ok: false, error: job.error ?? 'Print failed.' } : { ok: true, value: undefined }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IPC.openPrinterSettings, (event): Promise<Result> | Result => {
    if (!fromRenderer(event)) return refused
    const url = PRINTER_SETTINGS_URL[process.platform]
    if (!url) return { ok: false, error: 'Open your printer settings from the system menu.' }
    return attempt(() => shell.openExternal(url))
  })

  ipcMain.handle(IPC.setBlockOfflinePrinters, (event, enabled: unknown): Result => {
    if (!fromRenderer(event)) return refused
    if (typeof enabled !== 'boolean') return { ok: false, error: 'Expected on or off.' }
    updateSettings({ blockOfflinePrinters: enabled })
    notify()
    return { ok: true, value: undefined }
  })

  ipcMain.handle(IPC.setNotifications, (event, enabled: unknown): Result => {
    if (!fromRenderer(event)) return refused
    if (typeof enabled !== 'boolean') return { ok: false, error: 'Expected on or off.' }
    updateSettings({ notifications: enabled })
    notify()
    return { ok: true, value: undefined }
  })

  ipcMain.handle(IPC.setThemeMode, (event, mode: unknown): Result => {
    if (!fromRenderer(event)) return refused
    if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return { ok: false, error: 'Unknown theme.' }
    updateSettings({ themeMode: mode })
    notify()
    return { ok: true, value: undefined }
  })

  ipcMain.handle(IPC.setOpenAtLogin, (event, enabled: unknown): Result => {
    if (!fromRenderer(event)) return refused
    if (typeof enabled !== 'boolean') return { ok: false, error: 'Expected on or off.' }
    setOpenAtLogin(enabled)
    return { ok: true, value: undefined }
  })
}
