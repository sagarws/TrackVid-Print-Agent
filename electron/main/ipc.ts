import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/constants/channels'
import type { AgentState, Result } from '@shared/types/agent'
import { normaliseOrigin } from '@shared/utils/origin'
import { submitJob } from './jobs'
import { applyOpenAtLogin } from './loginItem'
import { logger } from './logger'
import { findPrinter, refreshPrinters } from './printers'
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

export const setOpenAtLogin = (enabled: boolean): void => {
  updateSettings({ openAtLogin: enabled })
  applyOpenAtLogin(enabled)
  notify()
}

export const registerIpc = (): void => {
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
      source: 'Test print'
    })
    return job.status === 'done' ? { ok: true, value: undefined } : { ok: false, error: job.error ?? 'Print failed.' }
  })

  ipcMain.handle(IPC.setAllowedOrigins, (event, origins: unknown): Result => {
    if (!fromRenderer(event)) return refused
    if (!Array.isArray(origins)) return { ok: false, error: 'Expected a list of websites.' }
    const invalid = origins.filter(entry => typeof entry !== 'string' || !normaliseOrigin(entry))
    if (invalid.length) return { ok: false, error: `Not a website address: ${invalid.map(String).join(', ')}` }
    updateSettings({ allowedOrigins: origins as string[] })
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
