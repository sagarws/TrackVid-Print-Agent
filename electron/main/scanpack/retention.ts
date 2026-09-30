import { existsSync, readdirSync, rmdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { CleanupSummary } from '@shared/types/scanpack'
import { isWeekExpired, ROOT_FOLDER_NAME, WEEK_FOLDER_PATTERN } from '@shared/utils/weekFolder'
import { logger } from '../logger'
import { getSettings } from '../settings'
import { allPacklogs, removePacklogWithFiles, storageRoot } from './store'

/**
 * The backend's two nightly Scan & Pack jobs, as one local job:
 *   cleanupExpiredPacklogs         → drop packlogs (records + PDFs) from expired weeks
 *   cleanupExpiredDriveWeekFolders → drop expired week folders
 *
 * "Expired" is the backend's rule with a configurable count: keep the current
 * IST week and the (N-1) before it; anything older goes.
 *
 * Only this app's own files are touched. In an expired week folder a file is
 * deleted only when its name is a packlog PDF (`SP-…-label|invoice|source-….pdf`),
 * and the folder itself is removed only once it is empty — so anything else
 * someone saved there survives.
 */
const OWN_FILE = /^SP-[A-Za-z0-9-]+-(label|invoice|source)-.+\.pdf$/

/** Runs at startup, then every 6 hours (the backend runs nightly; a laptop may not be on at 2 am). */
const INTERVAL_MS = 6 * 60 * 60 * 1000

let lastCleanup: CleanupSummary | null = null
let timer: NodeJS.Timeout | null = null

export const getLastCleanup = (): CleanupSummary | null => lastCleanup

export const runScanPackCleanup = (now = new Date()): CleanupSummary => {
  const weeksKept = getSettings().scanPackWeeksKept
  const summary: CleanupSummary = { at: now.toISOString(), packlogsDeleted: 0, filesDeleted: 0, foldersDeleted: 0, failed: 0 }

  for (const packlog of allPacklogs()) {
    if (!isWeekExpired(packlog.weekEnd, now, weeksKept)) continue
    try {
      const result = removePacklogWithFiles(packlog._id)
      summary.packlogsDeleted++
      summary.filesDeleted += result.deleted
      summary.failed += result.failed
    } catch (error) {
      summary.failed++
      logger.error(`[scanpack.cleanup] could not delete packlog ${packlog.packlogId}`, error)
    }
  }

  const root = join(storageRoot(), ROOT_FOLDER_NAME)
  if (existsSync(root)) {
    for (const name of readdirSync(root)) {
      const match = WEEK_FOLDER_PATTERN.exec(name)
      const weekEnd = match?.[2]
      if (!weekEnd || !isWeekExpired(weekEnd, now, weeksKept)) continue
      const folder = join(root, name)
      try {
        if (!statSync(folder).isDirectory()) continue
        for (const file of readdirSync(folder)) {
          if (!OWN_FILE.test(file)) continue
          rmSync(join(folder, file), { force: true })
          summary.filesDeleted++
        }
        if (readdirSync(folder).length === 0) {
          rmdirSync(folder)
          summary.foldersDeleted++
        }
      } catch (error) {
        summary.failed++
        logger.warn(`[scanpack.cleanup] could not clean ${folder}`, error)
      }
    }
  }

  lastCleanup = summary
  logger.info('[scanpack.cleanup] done', summary)
  return summary
}

export const startScanPackCleanup = (): void => {
  if (timer) return
  try {
    runScanPackCleanup()
  } catch (error) {
    logger.error('[scanpack.cleanup] startup run failed', error)
  }
  timer = setInterval(() => {
    try {
      runScanPackCleanup()
    } catch (error) {
      logger.error('[scanpack.cleanup] scheduled run failed', error)
    }
  }, INTERVAL_MS)
}

export const stopScanPackCleanup = (): void => {
  if (timer) clearInterval(timer)
  timer = null
}
