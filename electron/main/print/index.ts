import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrintFormat, PrintOptions } from '@shared/types/agent'
import type { PrintBackend } from './backend'
import { cupsBackend } from './cups'
import { windowsBackend } from './windows'

export const backend: PrintBackend = process.platform === 'win32' ? windowsBackend : cupsBackend

/**
 * Send one job's bytes to one printer by its OS name. Resolves when the OS
 * print queue has accepted the job, with the queue's id for it when the OS
 * gives one; rejects with a message fit to show a packer.
 */
export const printBytes = async (
  bytes: Buffer,
  printer: string,
  title: string,
  format: PrintFormat,
  options?: PrintOptions
): Promise<{ osJobId?: string }> => {
  // A private folder per job: nothing else on the machine can guess the path
  // or swap the file between writing and printing. The file name is unique so
  // the Windows spooler job can be found by it.
  const dir = await mkdtemp(join(tmpdir(), 'trackvid-print-'))
  const file = join(dir, `trackvid-${randomBytes(6).toString('hex')}.${format === 'pdf' ? 'pdf' : 'prn'}`)
  try {
    await writeFile(file, bytes)
    return await backend.print(file, printer, title, format, options)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
