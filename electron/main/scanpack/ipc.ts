import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { SCANPACK_IPC } from '@shared/constants/channels'
import type { Result } from '@shared/types/agent'
import type { CreatePacklogInput, PartName } from '@shared/types/scanpack'
import { clampWeeks, ROOT_FOLDER_NAME } from '@shared/utils/weekFolder'
import { submitJob } from '../jobs'
import { logger } from '../logger'
import { updateSettings } from '../settings'
import { notify } from '../state'
import { isRendererUrl } from '../window'
import { printPerf } from './perf'
import { runScanPackCleanup } from './retention'
import {
  createPacklog,
  deletePacklog,
  downloadPart,
  getPacklog,
  listPacklogs,
  markPacked,
  ScanPackError,
  storageRoot,
  uploadPart
} from './store'

const isPart = (value: unknown): value is PartName => value === 'label' || value === 'invoice'
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/**
 * Runs one Scan & Pack call for this app's own page only, and turns any
 * failure into `{ ok: false, error }` with words fit for a packer.
 */
const handle = <A extends unknown[], T>(
  channel: string,
  fn: (...args: A) => T | Promise<T>
): void => {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<Result<T>> => {
    if (!isRendererUrl(event.senderFrame?.url ?? '')) return { ok: false, error: 'Not allowed.' }
    try {
      return { ok: true, value: await fn(...(args as A)) }
    } catch (error) {
      if (!(error instanceof ScanPackError)) logger.error(`[scanpack] ${channel} failed`, error)
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

const toBuffer = (bytes: unknown): Buffer => {
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes)
  throw new ScanPackError('Expected PDF bytes.', 'bad_request')
}

export const registerScanPackIpc = (): void => {
  // Timing lines from the window. One-way (send, not invoke) and capped, so a
  // chatty scan can neither stall nor flood the main process.
  ipcMain.on(SCANPACK_IPC.perf, (event, lines: unknown) => {
    if (!isRendererUrl(event.senderFrame?.url ?? '')) return
    if (!Array.isArray(lines)) return
    printPerf(lines.filter((line): line is string => typeof line === 'string').slice(0, 1000).map(line => line.slice(0, 500)))
  })

  handle(SCANPACK_IPC.create, (input: CreatePacklogInput) => {
    if (!input || !isText(input.packlogId) || !isText(input.platform) || !Array.isArray(input.orders)) {
      throw new ScanPackError('The packlog is missing its id, platform or orders.', 'bad_request')
    }
    if (!['label', 'invoice', 'both'].includes(input.scanMode)) {
      throw new ScanPackError('scanMode must be label, invoice or both.', 'bad_request')
    }
    return createPacklog(input)
  })

  handle(SCANPACK_IPC.list, (opts: { page?: number; limit?: number; platform?: string } = {}) => listPacklogs(opts ?? {}))

  handle(SCANPACK_IPC.get, (id: string) => getPacklog(String(id)))

  handle(SCANPACK_IPC.remove, (id: string) => {
    deletePacklog(String(id))
    return undefined
  })

  handle(SCANPACK_IPC.upload, (id: string, orderId: string, part: unknown, bytes: unknown, pageCount: unknown) => {
    if (!isPart(part)) throw new ScanPackError('part must be label or invoice.', 'bad_request')
    return uploadPart(String(id), String(orderId), part, toBuffer(bytes), Math.max(0, Number(pageCount) || 0))
  })

  handle(SCANPACK_IPC.download, async (id: string, orderId: string, part: unknown) => {
    if (!isPart(part)) throw new ScanPackError('part must be label or invoice.', 'bad_request')
    // Sent as a Uint8Array: structured clone keeps it binary, no base64 round trip.
    return new Uint8Array(await downloadPart(String(id), String(orderId), part))
  })

  handle(SCANPACK_IPC.markPacked, (id: string, orderId: string) => markPacked(String(id), String(orderId)))

  /** Print through the agent's own queue — same checks, same job list as the web app's prints. */
  handle(SCANPACK_IPC.print, async (printer: unknown, bytes: unknown, jobName: unknown) => {
    if (!isText(printer)) throw new ScanPackError('Pick a printer in Printer Setup first.', 'no_printer')
    const job = await submitJob({
      bytes: toBuffer(bytes),
      printer,
      name: isText(jobName) ? jobName.slice(0, 120) : 'Scan & Pack',
      source: 'Scan & Pack',
      format: 'pdf'
    })
    if (job.status === 'failed') throw new ScanPackError(job.error ?? 'The printer did not accept the job.', 'print_failed')
    return { jobId: job.id, status: job.status }
  })

  handle(SCANPACK_IPC.chooseDir, async () => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options = {
      title: 'Choose where Scan & Pack saves its PDFs',
      defaultPath: storageRoot(),
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null
    updateSettings({ scanPackDir: picked })
    notify()
    return picked
  })

  handle(SCANPACK_IPC.resetDir, () => {
    updateSettings({ scanPackDir: null })
    notify()
    return storageRoot()
  })

  handle(SCANPACK_IPC.openDir, async () => {
    const folder = join(storageRoot(), ROOT_FOLDER_NAME)
    await mkdir(folder, { recursive: true })
    const error = await shell.openPath(folder)
    if (error) throw new ScanPackError(error, 'open_failed')
    return undefined
  })

  handle(SCANPACK_IPC.setWeeksKept, (weeks: unknown) => {
    updateSettings({ scanPackWeeksKept: clampWeeks(Number(weeks)) })
    // Apply the new window right away rather than at the next scheduled run.
    const summary = runScanPackCleanup()
    notify()
    return summary
  })

  handle(SCANPACK_IPC.runCleanup, () => {
    const summary = runScanPackCleanup()
    notify()
    return summary
  })
}
