import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { printWithCups } from './mac'
import { printWithSumatra } from './windows'

/**
 * Send one PDF to one printer by its OS name. Resolves when the OS print queue
 * has accepted the job; rejects with a message fit to show a packer.
 */
export const printPdf = async (bytes: Buffer, printer: string, title: string): Promise<void> => {
  // A private folder per job: nothing else on the machine can guess the path
  // or swap the file between writing and printing.
  const dir = await mkdtemp(join(tmpdir(), 'trackvid-print-'))
  const file = join(dir, 'job.pdf')
  try {
    await writeFile(file, bytes)
    if (process.platform === 'win32') await printWithSumatra(file, printer)
    else await printWithCups(file, printer, title)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
