import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * macOS (and Linux): hand the file to CUPS with `lp`.
 *
 * `lp` returns once CUPS has taken a copy of the file into its spool, which is
 * the same guarantee QZ Tray gave: the job is queued, not that paper came out.
 * `fit-to-page` matches what QZ did by default, so a label PDF that is a little
 * larger than the stock still lands on it whole.
 */
export const printWithCups = async (file: string, printer: string, title: string): Promise<void> => {
  const lp = process.platform === 'darwin' ? '/usr/bin/lp' : 'lp'
  // execFile, never a shell: the printer name comes from the network request
  // (checked against the OS list first, but still never interpolated).
  await run(lp, ['-d', printer, '-t', title, '-o', 'fit-to-page', '--', file], { timeout: 60_000 })
}
