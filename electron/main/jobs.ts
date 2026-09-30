import { randomUUID } from 'node:crypto'
import { JOB_HISTORY_LIMIT } from '@shared/constants/agent'
import type { PrintJob } from '@shared/types/agent'
import { logger } from './logger'
import { printPdf } from './print'
import { setJobs } from './state'

let history: PrintJob[] = []
/**
 * Jobs run one at a time, in arrival order. Two scans a second apart must come
 * out of the printer in that order, and SumatraPDF / lp started concurrently
 * give no such promise.
 */
let tail: Promise<unknown> = Promise.resolve()

const record = (job: PrintJob): void => {
  history = [job, ...history.filter(entry => entry.id !== job.id)].slice(0, JOB_HISTORY_LIMIT)
  setJobs(history)
}

export const submitJob = (input: { bytes: Buffer; printer: string; name: string; source: string }): Promise<PrintJob> => {
  const job: PrintJob = {
    id: randomUUID(),
    source: input.source,
    printer: input.printer,
    name: input.name,
    status: 'printing',
    startedAt: new Date().toISOString()
  }
  record(job)

  const run = async (): Promise<PrintJob> => {
    try {
      await printPdf(input.bytes, input.printer, input.name)
      const done: PrintJob = { ...job, status: 'done', finishedAt: new Date().toISOString() }
      record(done)
      logger.info('Printed', { printer: job.printer, source: job.source, name: job.name })
      return done
    } catch (error) {
      const message = describePrintError(error)
      const failed: PrintJob = { ...job, status: 'failed', error: message, finishedAt: new Date().toISOString() }
      record(failed)
      logger.error('Print failed', { printer: job.printer, source: job.source, error: message })
      return failed
    }
  }

  const result = tail.then(run, run)
  tail = result
  return result
}

/** lp / SumatraPDF errors carry stderr on the error object; surface that. */
const describePrintError = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const { stderr, message } = error as { stderr?: unknown; message?: unknown }
    if (typeof stderr === 'string' && stderr.trim()) return stderr.trim()
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return typeof error === 'string' ? error : 'The printer did not accept the job.'
}
