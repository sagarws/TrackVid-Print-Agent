import { randomUUID } from 'node:crypto'
import { JOB_HISTORY_LIMIT, JOB_POLL_MS, REPRINT_CACHE } from '@shared/constants/agent'
import type { AgentPrinter, JobStatus, PrintFormat, PrintJob, PrintOptions, QueueJobState } from '@shared/types/agent'
import { logger } from './logger'
import { notifyUser } from './notify'
import { backend, printBytes } from './print'
import { blocksPrinting } from './print/status'
import { findPrinter } from './printers'
import { getSettings } from './settings'
import { getPrinters, setJobs } from './state'

let history: PrintJob[] = []
/**
 * Jobs are handed to the OS one at a time, in arrival order. Two scans a
 * second apart must come out of the printer in that order, and SumatraPDF / lp
 * started concurrently give no such promise.
 */
let tail: Promise<unknown> = Promise.resolve()

const record = (job: PrintJob): PrintJob => {
  history = [job, ...history.filter(entry => entry.id !== job.id)].slice(0, JOB_HISTORY_LIMIT)
  setJobs(history)
  return job
}

export const getJob = (id: string): PrintJob | undefined => history.find(job => job.id === id)
export const listJobs = (): PrintJob[] => history

const FINISHED: readonly JobStatus[] = ['done', 'failed', 'cancelled']
export const isFinished = (job: PrintJob): boolean => FINISHED.includes(job.status)

/* ------------------------------------------------------------------ reprint */

/**
 * The last few jobs' bytes stay in memory so a packer can reprint a torn label
 * without going back to the web app. Bounded by count and by size.
 */
const payloads = new Map<string, Buffer>()

const keepPayload = (id: string, bytes: Buffer): void => {
  payloads.set(id, bytes)
  let total = [...payloads.values()].reduce((sum, buffer) => sum + buffer.length, 0)
  for (const [key, buffer] of payloads) {
    if (payloads.size <= REPRINT_CACHE.maxJobs && total <= REPRINT_CACHE.maxBytes) break
    payloads.delete(key)
    total -= buffer.length
    const job = getJob(key)
    if (job?.canReprint) record({ ...job, canReprint: false })
  }
}

/* ----------------------------------------------------------------- tracking */

const QUEUE_TO_JOB: Record<QueueJobState, JobStatus> = {
  pending: 'queued',
  held: 'held',
  printing: 'printing',
  // Stopped on an error at the printer: still in the queue, waiting.
  stopped: 'queued',
  cancelled: 'cancelled',
  aborted: 'failed',
  completed: 'done'
}

const withoutMessage = (job: PrintJob): PrintJob => {
  const copy = { ...job }
  delete copy.message
  return copy
}

/** Jobs the OS still has, polled until they finish. */
const tracked = new Set<string>()
let trackTimer: NodeJS.Timeout | null = null
const TRACK_LIMIT_MS = 24 * 60 * 60_000

const waitingMessage = (printer: AgentPrinter | undefined, reasons: string[]): string | undefined => {
  if (printer && printer.status.state !== 'ready' && printer.status.state !== 'printing') {
    return `Waiting — ${printer.status.message}`
  }
  if (reasons.includes('job-hold-until-specified')) return 'Held in the queue — press Release to print it'
  return undefined
}

const pollTracked = async (): Promise<void> => {
  // The printer monitor keeps this list fresh; no extra probing per poll.
  const printers = getPrinters()
  for (const id of [...tracked]) {
    const job = getJob(id)
    if (!job?.osJobId || isFinished(job)) {
      tracked.delete(id)
      continue
    }
    try {
      const os = await backend.getJob(job.printer, job.osJobId)
      // Gone from the OS queue: the Windows spooler drops a job once printed.
      const status: JobStatus = os ? QUEUE_TO_JOB[os.state] : 'done'
      const printer = printers.find(entry => entry.name === job.printer)
      const message = FINISHED.includes(status) ? undefined : waitingMessage(printer, os?.reasons ?? [])
      if (status !== job.status || message !== job.message) {
        const next = record({
          ...withoutMessage(job),
          status,
          ...(message ? { message } : {}),
          ...(status === 'failed' ? { error: os?.message || 'The printer system gave up on the job.' } : {}),
          ...(FINISHED.includes(status) ? { finishedAt: new Date().toISOString() } : {})
        })
        logger.info('Job update', { printer: job.printer, osJobId: job.osJobId, status })
        if (status === 'failed') notifyUser(`Print failed on ${job.printer}`, `${job.name}: ${next.error ?? ''}`)
      }
      if (FINISHED.includes(status) || Date.now() - Date.parse(job.startedAt) > TRACK_LIMIT_MS) tracked.delete(id)
    } catch (error) {
      logger.warn('Could not read job state', { osJobId: job.osJobId, error: error instanceof Error ? error.message : error })
    }
  }
  if (tracked.size === 0 && trackTimer) {
    clearInterval(trackTimer)
    trackTimer = null
  }
}

let polling = false
const track = (id: string): void => {
  tracked.add(id)
  trackTimer ??= setInterval(() => {
    if (polling) return
    polling = true
    void pollTracked().finally(() => {
      polling = false
    })
  }, JOB_POLL_MS)
}

/* --------------------------------------------------------------- submitting */

export interface JobInput {
  bytes: Buffer
  printer: string
  name: string
  source: string
  format: PrintFormat
  options?: PrintOptions
  /** Queue it even when the printer is offline / paused (it prints once it is back). */
  allowOffline?: boolean
}

/** Why a job is refused before it reaches the queue. */
const refusal = (printer: AgentPrinter): string => {
  const who = printer.displayName
  switch (printer.status.state) {
    case 'paused':
      return `${who} is paused on this computer, so nothing would print. Open the TrackVid Print Agent and press Resume.`
    case 'offline':
      return `${who} is offline (${printer.status.message}). Switch it on and check it is connected, then print again.`
    default:
      return `${who} is not accepting jobs right now (${printer.status.message}).`
  }
}

const describePrintError = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const { stderr, message } = error as { stderr?: unknown; message?: unknown }
    if (typeof stderr === 'string' && stderr.trim()) return stderr.trim()
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return typeof error === 'string' ? error : 'The printer did not accept the job.'
}

/**
 * Queue a job. Resolves once the OS print queue has taken it (status queued,
 * printing or done) or it was refused (failed). The job keeps being tracked
 * afterwards, so its status moves on to done / failed as the printer works.
 */
export const submitJob = (input: JobInput): Promise<PrintJob> => {
  const job = record({
    id: randomUUID(),
    source: input.source,
    printer: input.printer,
    name: input.name,
    format: input.format,
    status: 'sending',
    ...(input.options && Object.keys(input.options).length ? { options: input.options } : {}),
    canReprint: true,
    startedAt: new Date().toISOString()
  })
  keepPayload(job.id, input.bytes)

  const fail = (message: string): PrintJob => {
    logger.error('Print failed', { printer: job.printer, source: job.source, error: message })
    notifyUser(`Print failed on ${job.printer}`, message)
    return record({ ...job, status: 'failed', error: message, finishedAt: new Date().toISOString() })
  }

  const run = async (): Promise<PrintJob> => {
    try {
      const printer = await findPrinter(input.printer)
      if (!printer) return fail(`Printer "${input.printer}" is not installed on this computer.`)
      if (getSettings().blockOfflinePrinters && !input.allowOffline && blocksPrinting(printer.status)) {
        return fail(refusal(printer))
      }

      const { osJobId } = await printBytes(input.bytes, input.printer, input.name, input.format, input.options)
      logger.info('Queued', { printer: job.printer, source: job.source, name: job.name, osJobId })
      // No id back (Windows, when the spooler finished before it was asked):
      // there is nothing left to watch.
      const queued = record({
        ...job,
        status: osJobId ? 'queued' : 'done',
        ...(osJobId ? { osJobId } : { finishedAt: new Date().toISOString() })
      })
      if (osJobId) track(queued.id)
      return queued
    } catch (error) {
      return fail(describePrintError(error))
    }
  }

  const result = tail.then(run, run)
  tail = result
  return result
}

/* ------------------------------------------------------------------ actions */

const requireJob = (id: string): PrintJob => {
  const job = getJob(id)
  if (!job) throw new Error('That job is no longer in the list.')
  return job
}

export const cancelJob = async (id: string): Promise<PrintJob> => {
  const job = requireJob(id)
  if (isFinished(job)) return job
  if (!job.osJobId) throw new Error('The job has not reached the print queue yet.')
  await backend.cancelJob(job.printer, job.osJobId)
  logger.info('Cancelled', { printer: job.printer, osJobId: job.osJobId })
  tracked.delete(id)
  return record({ ...withoutMessage(job), status: 'cancelled', finishedAt: new Date().toISOString() })
}

export const releaseJob = async (id: string): Promise<PrintJob> => {
  const job = requireJob(id)
  if (!job.osJobId || job.status !== 'held') return job
  await backend.releaseJob(job.printer, job.osJobId)
  logger.info('Released', { printer: job.printer, osJobId: job.osJobId })
  track(id)
  return record({ ...job, status: 'queued' })
}

export const reprintJob = (id: string): Promise<PrintJob> => {
  const job = requireJob(id)
  const bytes = payloads.get(id)
  if (!bytes) return Promise.reject(new Error('That job is too old to reprint here. Print it again from TrackVid.'))
  return submitJob({
    bytes,
    printer: job.printer,
    name: job.name,
    source: 'Reprint',
    format: job.format,
    ...(job.options ? { options: job.options } : {})
  })
}
