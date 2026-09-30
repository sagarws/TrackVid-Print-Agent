import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import type {
  ExtractionJob,
  ExtractionJobSummary,
  JobCounts,
  JobRecord,
  PartName
} from '@shared/types/scanpack'
import { roundRobin } from '@shared/utils/weekFolder'
import { logger } from '../logger'
import { getSettings } from '../settings'
import { printPerf } from './perf'
import { attachExtracted, extractionPlan, packlogsNeedingExtraction, type ExtractTask } from './store'

/**
 * Background extraction of per-order PDFs, after an upload.
 *
 * The upload itself only saves the source PDF and each order's page numbers
 * (so it finishes in about the time the scan takes). A job then cuts one PDF
 * per order part into the week folder, on N utility processes at once — N
 * from Settings — with the records dealt round-robin:
 *
 *   3 workers, 15 records   worker 1: 1, 4, 7, 10, 13
 *                           worker 2: 2, 5, 8, 11, 14
 *                           worker 3: 3, 6, 9, 12, 15
 *
 * so the first N records are cut first and together. Until a record's PDF
 * exists, printing it uses the source with a page range, so nothing waits.
 *
 * Every job is kept on disk (one JSON file each in <userData>/scanpack-jobs)
 * for the Background process screen, until someone deletes it. A job cut
 * short by a quit is resumed at the next start.
 */

const jobsDir = (): string => join(app.getPath('userData'), 'scanpack-jobs')

const jobs = new Map<string, ExtractionJob>()
const queue: string[] = []
let running: { jobId: string; workers: UtilityProcess[]; cancelled: boolean } | null = null
const waiters = new Map<string, { count: number; resolve: () => void }[]>()

// Change notification, throttled per job: records flip many times a second.
type Listener = (jobId: string) => void
let listener: Listener | null = null
const pending = new Set<string>()
let notifyTimer: NodeJS.Timeout | null = null

export const onJobChanged = (fn: Listener): void => {
  listener = fn
}

const changed = (jobId: string): void => {
  pending.add(jobId)
  dirty.add(jobId)
  notifyTimer ??= setTimeout(() => {
    notifyTimer = null
    const ids = [...pending]
    pending.clear()
    for (const id of ids) listener?.(id)
    flushJobs()
  }, 250)
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const dirty = new Set<string>()

const jobFile = (id: string): string => join(jobsDir(), `${id}.json`)

const flushJobs = (): void => {
  mkdirSync(jobsDir(), { recursive: true })
  for (const id of dirty) {
    const job = jobs.get(id)
    if (!job) continue
    try {
      const temp = `${jobFile(id)}.tmp`
      writeFileSync(temp, JSON.stringify(job))
      renameSync(temp, jobFile(id))
    } catch (error) {
      logger.error(`[scanpack.jobs] could not save job ${id}`, error)
    }
  }
  dirty.clear()
}

const loadJobs = (): void => {
  const dir = jobsDir()
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      const job = JSON.parse(readFileSync(join(dir, name), 'utf8')) as ExtractionJob
      if (job?.id && Array.isArray(job.records)) jobs.set(job.id, job)
    } catch (error) {
      logger.warn(`[scanpack.jobs] skipped unreadable job ${name}`, error)
    }
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const countsOf = (records: JobRecord[]): JobCounts => ({
  total: records.length,
  done: records.filter(r => r.status === 'done').length,
  missing: records.filter(r => r.status === 'missing').length,
  failed: records.filter(r => r.status === 'failed').length
})

const summary = ({ records: _records, ...rest }: ExtractionJob): ExtractionJobSummary => rest

export const listJobs = (): ExtractionJobSummary[] =>
  [...jobs.values()].map(summary).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

export const getJob = (id: string): ExtractionJob | null => jobs.get(id) ?? null

// ---------------------------------------------------------------------------
// Creating and running
// ---------------------------------------------------------------------------

/**
 * Create a job for a packlog's records and queue it. Every sheet record is in
 * it — those with no PDF at all show as missing straight away.
 */
export const enqueueExtraction = (packlogObjectId: string): string | null => {
  const plan = extractionPlan(packlogObjectId)
  if (!plan) return null
  const workers = Math.max(1, getSettings().scanPackWorkers)
  const dealt = roundRobin(plan.records, workers)
  const workerOf = new Map<string, number>()
  dealt.forEach((bucket, index) => bucket.forEach(r => workerOf.set(r.orderId, index + 1)))

  const records: JobRecord[] = plan.records.map(r => ({
    record: r.record,
    awb: r.awb,
    orderId: r.orderId,
    worker: workerOf.get(r.orderId) ?? 1,
    parts: [...r.done, ...r.tasks.map(t => t.part)],
    status: r.tasks.length ? 'pending' : r.done.length ? 'done' : 'missing'
  }))
  const id = randomBytes(8).toString('hex')
  const job: ExtractionJob = {
    id,
    packlogObjectId,
    packlogId: plan.packlogId,
    orderFileName: plan.orderFileName,
    platform: plan.platform,
    workers: Math.min(workers, Math.max(1, records.length)),
    state: 'queued',
    counts: countsOf(records),
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    records
  }
  jobs.set(id, job)
  queue.push(id)
  changed(id)
  pump()
  return id
}

/** The compiled worker next to main.js; unpacked from app.asar when packaged. */
const workerScript = (): string => {
  const inAsar = join(__dirname, 'extractWorker.js')
  const unpacked = inAsar.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  return existsSync(unpacked) ? unpacked : inAsar
}

const finishJob = (job: ExtractionJob, state: ExtractionJob['state']): void => {
  job.state = state
  job.finishedAt = new Date().toISOString()
  job.counts = countsOf(job.records)
  const { total, done, missing, failed } = job.counts
  printPerf([
    `── Extraction ${state}: ${job.packlogId} — ${done} of ${total} records saved, ${missing} with no PDF, ${failed} failed (${job.workers} workers) ──`
  ])
  settle(job, true)
  changed(job.id)
}

/** Wake anyone waiting for the first N records of this job. */
const settle = (job: ExtractionJob, all = false): void => {
  const list = waiters.get(job.id)
  if (!list?.length) return
  const remaining = list.filter(w => {
    const ready = all || job.records.slice(0, w.count).every(r => r.status !== 'pending' && r.status !== 'running')
    if (ready) w.resolve()
    return !ready
  })
  if (remaining.length) waiters.set(job.id, remaining)
  else waiters.delete(job.id)
}

const pump = (): void => {
  if (running) return
  const jobId = queue.shift()
  if (!jobId) return
  const job = jobs.get(jobId)
  if (!job || job.state === 'cancelled') return pump()
  const plan = extractionPlan(job.packlogObjectId)
  if (!plan) {
    finishJob(job, 'cancelled')
    return pump()
  }

  // Refresh each record from the store: a resumed job skips what is done.
  const tasksByOrder = new Map(plan.records.map(r => [r.orderId, r]))
  for (const record of job.records) {
    const planned = tasksByOrder.get(record.orderId)
    if (!planned) {
      record.status = 'failed'
      record.error = 'The order is no longer in the packlog.'
    } else if (!planned.tasks.length) {
      record.status = planned.done.length ? 'done' : 'missing'
    } else if (record.status !== 'done') {
      record.status = 'pending'
    }
  }

  // Each worker's tasks, in its records' order.
  const byWorker = new Map<number, ExtractTask[]>()
  for (const record of job.records) {
    if (record.status !== 'pending') continue
    const list = byWorker.get(record.worker) ?? []
    list.push(...(tasksByOrder.get(record.orderId)?.tasks ?? []))
    byWorker.set(record.worker, list)
  }

  job.state = 'running'
  job.startedAt ??= new Date().toISOString()
  job.counts = countsOf(job.records)
  changed(job.id)
  settle(job)

  if (!byWorker.size) {
    finishJob(job, 'finished')
    return pump()
  }

  printPerf([`── Extraction started: ${job.packlogId}, ${job.records.length} records over ${byWorker.size} workers ──`])
  const current: { jobId: string; workers: UtilityProcess[]; cancelled: boolean } = { jobId, workers: [], cancelled: false }
  running = current
  let open = byWorker.size
  const recordOf = new Map(job.records.map(r => [r.orderId, r]))
  const partsLeft = new Map(job.records.map(r => [r.orderId, new Set<PartName>(tasksByOrder.get(r.orderId)?.tasks.map(t => t.part) ?? [])]))
  const taskById = new Map([...byWorker.values()].flat().map(t => [t.taskId, t]))

  const workerDone = () => {
    open--
    if (open > 0) return
    running = null
    if (!current.cancelled) {
      // Anything a crashed worker never reported on.
      for (const record of job.records) {
        if (record.status === 'pending' || record.status === 'running') {
          record.status = 'failed'
          record.error ??= 'The extractor stopped before reaching this record.'
        }
      }
      finishJob(job, 'finished')
    }
    pump()
  }

  for (const [worker, tasks] of byWorker) {
    const child = utilityProcess.fork(workerScript(), [], { serviceName: `Scan & Pack extractor ${worker}` })
    current.workers.push(child)
    let finished = false

    child.on('message', (message: { type: string; taskId?: string; file?: string; ms?: number; parseMs?: number; kb?: number; error?: string }) => {
      const task = message.taskId ? taskById.get(message.taskId) : undefined
      const record = task ? recordOf.get(task.orderId) : undefined

      if (message.type === 'start' && record && record.status === 'pending') {
        record.status = 'running'
        changed(job.id)
      } else if (message.type === 'done' && task && record && message.file) {
        const attached = attachExtracted(job.packlogObjectId, task.orderId, task.part, message.file)
        if (!attached) rmSync(message.file, { force: true })
        record.files = [...(record.files ?? []), message.file]
        record.ms = (record.ms ?? 0) + (message.ms ?? 0)
        const left = partsLeft.get(task.orderId)
        left?.delete(task.part)
        if (!left?.size && record.status !== 'failed') record.status = 'done'
        printPerf([
          `[worker ${worker}] For record ${task.record} (${task.awb}) ${message.ms} ms taken in extract ${task.part}` +
            `${message.parseMs ? ` (incl. ${message.parseMs} ms parsing the source once)` : ''}, ${message.kb} KB`
        ])
        job.counts = countsOf(job.records)
        changed(job.id)
        settle(job)
      } else if (message.type === 'failed' && task && record) {
        record.status = 'failed'
        record.error = message.error ?? 'Cutting the PDF failed.'
        printPerf([`[worker ${worker}] For record ${task.record} (${task.awb}) FAILED in extract ${task.part}: ${record.error}`])
        job.counts = countsOf(job.records)
        changed(job.id)
        settle(job)
      } else if (message.type === 'finished' && !finished) {
        finished = true
        child.kill()
        workerDone()
      }
    })
    child.once('exit', () => {
      if (finished) return
      finished = true
      workerDone()
    })
    child.postMessage({ type: 'run', worker, tasks })
  }
}

/** Resolve once the first `count` records of a job are done (or failed / missing). */
export const waitForFirst = (jobId: string, count: number, timeoutMs = 120_000): Promise<void> =>
  new Promise(resolve => {
    const job = jobs.get(jobId)
    if (!job) return resolve()
    const timer = setTimeout(resolve, timeoutMs)
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    const list = waiters.get(jobId) ?? []
    list.push({ count: Math.max(1, count), resolve: done })
    waiters.set(jobId, list)
    settle(job, job.state === 'finished' || job.state === 'cancelled')
  })

// ---------------------------------------------------------------------------
// Stopping and deleting
// ---------------------------------------------------------------------------

const stopRunning = (state: 'cancelled' | 'interrupted'): void => {
  if (!running) return
  const job = jobs.get(running.jobId)
  running.cancelled = true
  for (const worker of running.workers) worker.kill()
  if (job) {
    for (const record of job.records) if (record.status === 'running') record.status = 'pending'
    job.state = state
    job.counts = countsOf(job.records)
    settle(job, true)
    changed(job.id)
  }
  running = null
}

/** Stop and forget any job for a packlog being deleted. */
export const cancelForPacklog = (packlogObjectId: string): void => {
  if (running && jobs.get(running.jobId)?.packlogObjectId === packlogObjectId) {
    stopRunning('cancelled')
    pump()
  }
  for (const [index, id] of [...queue.entries()].reverse()) {
    const job = jobs.get(id)
    if (job?.packlogObjectId !== packlogObjectId) continue
    queue.splice(index, 1)
    job.state = 'cancelled'
    changed(id)
  }
}

/**
 * Cut a job's packlog again: its per-order PDFs cut from source pages are
 * deleted and a new job cuts them with the current code. Returns the new job.
 */
export const rerunJob = (id: string, reset: (packlogObjectId: string) => { removed: number; freedKb: number }): string | null => {
  const job = jobs.get(id)
  if (!job) return null
  if (running?.jobId === id) {
    stopRunning('cancelled')
  }
  const { removed, freedKb } = reset(job.packlogObjectId)
  printPerf([`── Re-extract ${job.packlogId}: removed ${removed} saved PDF(s), ${Math.round(freedKb / 1024)} MB freed ──`])
  const next = enqueueExtraction(job.packlogObjectId)
  pump()
  return next
}

/** Remove a job from the history. A running one is stopped first. */
export const deleteJob = (id: string): void => {
  if (running?.jobId === id) {
    stopRunning('cancelled')
    pump()
  }
  const at = queue.indexOf(id)
  if (at >= 0) queue.splice(at, 1)
  jobs.delete(id)
  dirty.delete(id)
  pending.delete(id)
  rmSync(jobFile(id), { force: true })
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Load the history, and pick up any job a quit interrupted. */
export const startExtraction = (): void => {
  loadJobs()
  const resume = [...jobs.values()]
    .filter(job => job.state === 'running' || job.state === 'queued' || job.state === 'interrupted')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const job of resume) {
    job.state = 'queued'
    queue.push(job.id)
    changed(job.id)
  }
  // Packlogs with parts still uncut and no job at all in the history (its job
  // was deleted while running): a fresh job. A packlog whose job finished with
  // failures is not retried on every start — its record stays red.
  const covered = new Set([...jobs.values()].map(job => job.packlogObjectId))
  for (const packlogObjectId of packlogsNeedingExtraction()) {
    if (!covered.has(packlogObjectId)) enqueueExtraction(packlogObjectId)
  }
  pump()
}

export const stopExtraction = (): void => {
  stopRunning('interrupted')
  for (const id of queue.splice(0)) {
    const job = jobs.get(id)
    if (job) job.state = 'interrupted'
    dirty.add(id)
  }
  if (notifyTimer) clearTimeout(notifyTimer)
  flushJobs()
}
