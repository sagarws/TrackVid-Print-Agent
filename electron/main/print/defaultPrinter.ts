import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getDefaultPrinter } from 'pdf-to-printer'

const run = promisify(execFile)

/**
 * The OS default printer's name, or null when none is set. Electron's printer
 * list no longer reports it, so it is asked for separately:
 *   macOS / Linux  `lpstat -d` → "system default destination: Epson_L3250"
 *   Windows        pdf-to-printer's PowerShell query
 * A failure here only costs the "Default" badge, so it resolves null.
 */
export const readDefaultPrinter = async (): Promise<string | null> => {
  try {
    if (process.platform === 'win32') return (await getDefaultPrinter())?.name ?? null
    const lpstat = process.platform === 'darwin' ? '/usr/bin/lpstat' : 'lpstat'
    const { stdout } = await run(lpstat, ['-d'], { timeout: 5_000 })
    const match = /destination:\s*(.+)$/m.exec(stdout)
    return match?.[1]?.trim() || null
  } catch {
    // No default configured, or lpstat/PowerShell unavailable — no badge.
    return null
  }
}
