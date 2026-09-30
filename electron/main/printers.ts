import type { WebContents } from 'electron'
import { PRINTER_POLL_MS } from '@shared/constants/agent'
import type { AgentPrinter, PrinterState } from '@shared/types/agent'
import { logger } from './logger'
import { notifyUser } from './notify'
import { backend } from './print'
import { deriveStatus } from './print/status'
import { getJobs, getPrinters, setPrinters } from './state'

/**
 * The printer list with live status, kept fresh on a timer.
 *
 * Each refresh asks the OS for its queues and asks each device whether it is
 * really there (print/probe.ts), so the window and the web app see "offline"
 * as soon as a printer is switched off — not after a job has silently piled up
 * behind it.
 *
 * If the OS query itself fails, the list falls back to Chromium's printer list
 * (the one the system print dialog shows), with the status unknown, so a
 * packer can still print.
 */
let source: WebContents | null = null

export const setPrinterSource = (contents: WebContents): void => {
  source = contents
}

let inFlight: Promise<AgentPrinter[]> | null = null
let lastRefresh = 0
let lastError: string | null = null

const fallbackList = async (): Promise<AgentPrinter[]> => {
  if (!source || source.isDestroyed()) return []
  const found = await source.getPrintersAsync()
  return found.map(printer => ({
    name: printer.name,
    displayName: printer.displayName || printer.name,
    isDefault: false,
    connection: 'unknown' as const,
    status: deriveStatus({ reasons: [], acceptingJobs: true, reachable: null, paused: false }),
    supplies: [],
    queue: []
  }))
}

/** Link OS queue entries back to the agent jobs that created them. */
const tagAgentJobs = (printers: AgentPrinter[]): AgentPrinter[] => {
  const byOsId = new Map(
    getJobs()
      .filter(job => job.osJobId)
      .map(job => [`${job.printer}\n${job.osJobId}`, job.id])
  )
  return printers.map(printer => ({
    ...printer,
    queue: printer.queue.map(job => {
      const agentJobId = byOsId.get(`${printer.name}\n${job.id}`)
      return agentJobId ? { ...job, agentJobId } : job
    })
  }))
}

const PROBLEM_STATES: readonly PrinterState[] = ['offline', 'paused', 'error']

/**
 * Tell the packer when a printer they are using goes wrong. "Using" = this
 * session sent it a job, or its queue has work waiting; a printer that is
 * always off does not nag.
 */
const announceChanges = (previous: AgentPrinter[], next: AgentPrinter[]): void => {
  const before = new Map(previous.map(printer => [printer.name, printer.status]))
  const used = new Set(getJobs().map(job => job.printer))
  for (const printer of next) {
    const old = before.get(printer.name)
    if (!old) continue
    const nowProblem = PROBLEM_STATES.includes(printer.status.state)
    const changed = old.state !== printer.status.state || old.message !== printer.status.message
    if (nowProblem && changed && (used.has(printer.name) || printer.queue.length > 0)) {
      notifyUser(`${printer.displayName}: ${printer.status.message}`, 'Print jobs for this printer are waiting. Open the Print Agent for details.')
    }
    if (!nowProblem && PROBLEM_STATES.includes(old.state) && used.has(printer.name)) {
      logger.info('Printer recovered', { printer: printer.name, state: printer.status.state })
    }
  }
}

const readPrinters = async (): Promise<AgentPrinter[]> => {
  try {
    const printers = (await backend.listPrinters()).sort((a, b) => a.displayName.localeCompare(b.displayName))
    lastError = null
    return tagAgentJobs(printers)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message !== lastError) logger.error('Could not read printer status from the OS', error)
    lastError = message
    return fallbackList()
  }
}

export const refreshPrinters = (): Promise<AgentPrinter[]> => {
  inFlight ??= (async () => {
    try {
      const previous = getPrinters()
      const printers = await readPrinters()
      announceChanges(previous, printers)
      setPrinters(printers, printers.length === 0 && lastError ? lastError : undefined)
      return printers
    } catch (error) {
      logger.error('Could not list printers', error)
      setPrinters([], error instanceof Error ? error.message : 'Could not list printers.')
      return []
    } finally {
      lastRefresh = Date.now()
      inFlight = null
    }
  })()
  return inFlight
}

/** The printer list, re-read if it is older than `maxAgeMs`. */
export const freshPrinters = async (maxAgeMs: number): Promise<AgentPrinter[]> =>
  Date.now() - lastRefresh <= maxAgeMs && !inFlight ? getPrinters() : refreshPrinters()

/**
 * Is this a printer the OS actually has? Checked before every job, so a print
 * request can only ever name a real device. The monitor keeps the status at
 * most one poll old, so judging a job adds no wait for a probe.
 */
export const findPrinter = async (name: string, maxAgeMs = PRINTER_POLL_MS + 5_000): Promise<AgentPrinter | undefined> =>
  (await freshPrinters(maxAgeMs)).find(printer => printer.name === name)

let timer: NodeJS.Timeout | null = null

export const startPrinterMonitor = (): void => {
  if (timer) return
  void refreshPrinters()
  timer = setInterval(() => void refreshPrinters(), PRINTER_POLL_MS)
}

export const stopPrinterMonitor = (): void => {
  if (timer) clearInterval(timer)
  timer = null
}

/** Printer / queue actions from the window or the API; each re-reads the list after. */
const act = async (label: string, printer: string, action: () => Promise<void>): Promise<void> => {
  if (!(await findPrinter(printer, 60_000))) throw new Error(`Printer "${printer}" is not installed on this computer.`)
  try {
    await action()
    logger.info(label, { printer })
  } catch (error) {
    logger.error(`${label} failed`, { printer, error })
    const stderr = (error as { stderr?: unknown }).stderr
    const detail = typeof stderr === 'string' && stderr.trim() ? stderr.trim() : error instanceof Error ? error.message : String(error)
    const hint = /not authorized|forbidden|permission|access is denied/i.test(detail)
      ? `${detail} — an administrator account is needed for this.`
      : detail
    throw new Error(hint, { cause: error })
  } finally {
    await refreshPrinters()
  }
}

export const resumePrinter = (printer: string): Promise<void> =>
  act('Resumed printer', printer, () => backend.resumePrinter(printer))

export const clearPrinterQueue = (printer: string): Promise<void> =>
  act('Cleared printer queue', printer, () => backend.clearQueue(printer))

export const cancelQueueJob = (printer: string, osJobId: string): Promise<void> =>
  act(`Cancelled job ${osJobId}`, printer, () => backend.cancelJob(printer, osJobId))

export const releaseQueueJob = (printer: string, osJobId: string): Promise<void> =>
  act(`Released job ${osJobId}`, printer, () => backend.releaseJob(printer, osJobId))
