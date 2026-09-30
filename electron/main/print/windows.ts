import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { print } from 'pdf-to-printer'

/**
 * Windows: print through the SumatraPDF.exe that pdf-to-printer bundles.
 *
 * In a packaged app that exe is inside app.asar, where Windows cannot execute
 * it; electron-builder.yml unpacks it next to the archive and this points at
 * the unpacked copy explicitly. pdf-to-printer tries the same rewrite itself,
 * but only via `process.mainModule`, which Electron's main process does not
 * reliably set.
 */
const sumatraPath = (() => {
  let cached: string | null = null
  return (): string => {
    if (cached) return cached
    const dir = dirname(require.resolve('pdf-to-printer')).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    const exe = readdirSync(dir).find(name => /^SumatraPDF.*\.exe$/i.test(name))
    if (!exe) throw new Error(`SumatraPDF.exe is missing from ${dir}. Reinstall the TrackVid Print Agent.`)
    cached = join(dir, exe)
    return cached
  }
})()

export const printWithSumatra = async (file: string, printer: string): Promise<void> => {
  // `fit` matches QZ Tray's default, as on macOS. Resolves once SumatraPDF has
  // spooled the job and exited.
  await print(file, { printer, scale: 'fit', silent: true, sumatraPdfPath: sumatraPath() })
}
