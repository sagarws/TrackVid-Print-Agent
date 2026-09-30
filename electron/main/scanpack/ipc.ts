import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SCANPACK_IPC } from '@shared/constants/channels'
import type { Result } from '@shared/types/agent'
import type { CreatePacklogInput, PartName } from '@shared/types/scanpack'
import { clampWeeks, clampWorkers, ROOT_FOLDER_NAME, safeFileName } from '@shared/utils/weekFolder'
import { cancelForPacklog, deleteJob, enqueueExtraction, getJob, listJobs, rerunJob, waitForFirst } from './extractor'
import { submitJob } from '../jobs'
import { logger } from '../logger'
import { getSettings, updateSettings } from '../settings'
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
  mapOrders,
  markPacked,
  resetExtracted,
  printable,
  saveSource,
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
    cancelForPacklog(String(id))
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

  handle(SCANPACK_IPC.saveSource, (id: string, docId: unknown, name: unknown, bytes: unknown, pageCount: unknown) => {
    if (!isText(docId)) throw new ScanPackError('The source PDF has no id.', 'bad_request')
    return saveSource(String(id), docId, isText(name) ? name : 'labels.pdf', toBuffer(bytes), Math.max(0, Number(pageCount) || 0))
  })

  handle(SCANPACK_IPC.mapOrders, (id: string, maps: unknown) => {
    if (!Array.isArray(maps)) throw new ScanPackError('Expected a list of order pages.', 'bad_request')
    const clean = maps
      .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
      .map(m => ({
        orderId: typeof m['orderId'] === 'string' ? m['orderId'] : '',
        docId: typeof m['docId'] === 'string' ? m['docId'] : '',
        labelPages: Array.isArray(m['labelPages']) ? (m['labelPages'] as unknown[]).map(Number) : [],
        invoicePages: Array.isArray(m['invoicePages']) ? (m['invoicePages'] as unknown[]).map(Number) : []
      }))
    const result = mapOrders(String(id), clean)
    // Cut the per-order PDFs in the background, on the workers from Settings.
    const jobId = enqueueExtraction(String(id))
    return { ...result, jobId, workers: getSettings().scanPackWorkers }
  })

  handle(SCANPACK_IPC.waitForFirst, async (jobId: unknown, count: unknown) => {
    if (!isText(jobId)) return undefined
    await waitForFirst(jobId, Math.max(1, Number(count) || 1))
    return getJob(jobId)
  })

  handle(SCANPACK_IPC.listJobs, () => listJobs())
  handle(SCANPACK_IPC.getJob, (jobId: unknown) => (isText(jobId) ? getJob(jobId) : null))
  handle(SCANPACK_IPC.deleteJob, (jobId: unknown) => {
    if (isText(jobId)) deleteJob(jobId)
    return listJobs()
  })

  handle(SCANPACK_IPC.rerunJob, (jobId: unknown) => {
    if (!isText(jobId)) throw new ScanPackError('No job given.', 'bad_request')
    const next = rerunJob(jobId, resetExtracted)
    if (!next) throw new ScanPackError('That packlog no longer exists, so there is nothing to re-extract.', 'packlog_not_found')
    return listJobs()
  })

  /**
   * Auto Download: save an order's PDF to the OS Downloads folder, never
   * overwriting ("<AWB>-label.pdf", then "<AWB>-label (1).pdf" …). Resolves
   * with the path only once the file is written, which is what lets the pack
   * screen mark the order Packed.
   */
  handle(SCANPACK_IPC.saveDownload, async (bytes: unknown, fileName: unknown) => {
    const data = toBuffer(bytes)
    if (data.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ScanPackError('The file is not a PDF.', 'not_pdf')
    const safe = safeFileName(isText(fileName) ? fileName : 'order.pdf').slice(0, 150)
    const base = safe.toLowerCase().endsWith('.pdf') ? safe.slice(0, -4) : safe
    const dir = app.getPath('downloads')
    await mkdir(dir, { recursive: true })
    for (let n = 0; n < 1000; n++) {
      const file = join(dir, n ? `${base} (${n}).pdf` : `${base}.pdf`)
      try {
        // 'wx': fail if it exists, so two quick scans never overwrite each other.
        await writeFile(file, data, { flag: 'wx' })
        printPerf([`Auto Download saved ${Math.round(data.length / 1024)} KB → ${file}`])
        return file
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    throw new ScanPackError('Too many files with this name in Downloads.', 'name_taken')
  })

  handle(SCANPACK_IPC.setWorkers, (workers: unknown) => {
    updateSettings({ scanPackWorkers: clampWorkers(Number(workers)) })
    notify()
    return getSettings().scanPackWorkers
  })

  /**
   * Print one order's label / invoice / both on one printer. A part stored as
   * pages of the source PDF is printed from the source with a page range —
   * nothing is cut. One job per file, in order.
   */
  handle(SCANPACK_IPC.printPart, async (id: string, orderId: string, parts: unknown, printer: unknown, jobName: unknown) => {
    if (!Array.isArray(parts) || !parts.length || !parts.every(isPart)) {
      throw new ScanPackError('parts must be label and/or invoice.', 'bad_request')
    }
    if (!isText(printer)) throw new ScanPackError('Pick a printer in Printer Setup first.', 'no_printer')
    const start = performance.now()
    const items = await printable(String(id), String(orderId), parts)
    const name = isText(jobName) ? jobName.slice(0, 120) : 'Scan & Pack'
    const jobs = []
    for (const item of items) {
      const job = await submitJob({
        bytes: item.bytes,
        printer,
        name,
        source: 'Scan & Pack',
        format: 'pdf',
        ...(item.pages ? { options: { pages: item.pages } } : {})
      })
      if (job.status === 'failed') throw new ScanPackError(job.error ?? 'The printer did not accept the job.', 'print_failed')
      jobs.push({ jobId: job.id, status: job.status, pages: item.pages ?? null })
    }
    printPerf([
      `${Math.round(performance.now() - start)} ms taken in print ${parts.join(' + ')} (${items.map(i => (i.pages ? `pages ${i.pages} of ${Math.round(i.bytes.length / 1024)} KB source` : `${Math.round(i.bytes.length / 1024)} KB file`)).join('; ')}) → ${printer}`
    ])
    return jobs
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
