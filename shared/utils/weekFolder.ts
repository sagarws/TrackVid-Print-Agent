/**
 * Week-folder arithmetic for Scan & Pack files — the same rules TrackVid-BE
 * uses for Google Drive (src/utils/googleDrive/weekFolder.ts), applied to a
 * folder on this computer instead. Pure functions, so the retention rule is
 * unit-tested.
 *
 * Layout under the chosen folder:
 *   scan-and-pack/
 *     2026-09-21_to_2026-09-27/
 *       <packlogId>-label-<awb>.pdf
 *       <packlogId>-invoice-<awb>.pdf
 *
 * A packlog's files go into the folder of the week the packlog was CREATED in,
 * so a whole week can be dropped at once. Weeks run Monday → Sunday in IST;
 * India has no DST, so a fixed +05:30 offset is exact.
 */
export const ROOT_FOLDER_NAME = 'scan-and-pack'

/** The backend keeps this week and last week. Settings can change it here. */
export const DEFAULT_WEEKS_KEPT = 2
export const MIN_WEEKS_KEPT = 1
export const MAX_WEEKS_KEPT = 52

/** Parallel PDF extractors (utility processes) cutting per-order PDFs after an upload. */
export const DEFAULT_EXTRACT_WORKERS = 3
export const MIN_EXTRACT_WORKERS = 1
export const MAX_EXTRACT_WORKERS = 8

export const clampWorkers = (value: number): number =>
  Math.min(
    MAX_EXTRACT_WORKERS,
    Math.max(MIN_EXTRACT_WORKERS, Math.round(Number.isFinite(value) ? value : DEFAULT_EXTRACT_WORKERS))
  )

/**
 * Round-robin split of records over workers: with 3 workers and 15 records,
 * worker 1 gets 1, 4, 7, 10, 13 — so the first N records are all being cut
 * at once and are ready first.
 */
export const roundRobin = <T>(items: readonly T[], workers: number): T[][] => {
  const buckets: T[][] = Array.from({ length: Math.max(1, Math.min(workers, items.length)) }, () => [])
  items.forEach((item, index) => buckets[index % buckets.length]!.push(item))
  return buckets
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export interface WeekRange {
  /** Monday, `YYYY-MM-DD` (IST). */
  weekStart: string
  /** Sunday, `YYYY-MM-DD` (IST). */
  weekEnd: string
  /** Folder name inside `scan-and-pack/`. */
  folderName: string
}

/** The Monday–Sunday IST week containing `date`. */
export const weekRangeFor = (date: Date): WeekRange => {
  const ist = new Date(date.getTime() + IST_OFFSET_MS)
  const daysSinceMonday = (ist.getUTCDay() + 6) % 7
  const monday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - daysSinceMonday * DAY_MS)
  const sunday = new Date(monday.getTime() + 6 * DAY_MS)
  const weekStart = monday.toISOString().slice(0, 10)
  const weekEnd = sunday.toISOString().slice(0, 10)
  return { weekStart, weekEnd, folderName: `${weekStart}_to_${weekEnd}` }
}

/**
 * DAY-WISE LAYOUT (current): each packlog's PDFs live in
 *   scan-and-pack/<YYYY-MM-DD>/<packlogId>/
 * — the IST day the packlog was created, then the packlog itself, so a day's
 * or a packlog's files are one folder to find. Retention is still by week:
 * a day folder expires with the week it belongs to.
 */

/** `YYYY-MM-DD` of the IST day `date` falls on. */
export const istDateKey = (date: Date): string => new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)

/** Folder names below `scan-and-pack/` for a packlog: [day, packlogId]. */
export const packlogFolderParts = (createdAt: Date, packlogId: string): [string, string] => [
  istDateKey(createdAt),
  packlogId.replace(/[<>:"/\\|?*]/g, '_')
]

/** A day folder this app made: `YYYY-MM-DD`. */
export const DAY_FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** A packlog folder this app made, inside a day folder. */
export const PACKLOG_FOLDER_PATTERN = /^SP-[A-Za-z0-9-]+$/

/** A day folder expires with its (IST) week. */
export const isDayExpired = (dayKey: string, now: Date, weeksKept: number): boolean =>
  // Noon IST on that day, well inside it whatever the host's time zone.
  isWeekExpired(weekRangeFor(new Date(`${dayKey}T06:30:00Z`)).weekEnd, now, weeksKept)

/**
 * LEGACY LAYOUT: week folders (`YYYY-MM-DD_to_YYYY-MM-DD`) from before the
 * day-wise layout. Only folders this app names are ever deleted.
 */
export const WEEK_FOLDER_PATTERN = /^(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})$/

/**
 * The Monday of the oldest week still kept. With 2 weeks kept that is last
 * week's Monday: this week and last week stay, the week before last goes.
 */
export const retentionCutoffKey = (now: Date, weeksKept: number): string =>
  weekRangeFor(new Date(now.getTime() - (clampWeeks(weeksKept) - 1) * 7 * DAY_MS)).weekStart

/** `YYYY-MM-DD` keys compare correctly as strings. */
export const isWeekExpired = (weekEnd: string, now: Date, weeksKept: number): boolean =>
  weekEnd < retentionCutoffKey(now, weeksKept)

export const clampWeeks = (value: number): number =>
  Math.min(MAX_WEEKS_KEPT, Math.max(MIN_WEEKS_KEPT, Math.round(Number.isFinite(value) ? value : DEFAULT_WEEKS_KEPT)))

/** A file name any OS accepts: characters Windows or macOS refuse, and control characters, become `_`. */
export const safeFileName = (name: string): string =>
  [...name].map(ch => ('<>:"/\\|?*'.includes(ch) || ch.charCodeAt(0) < 32 ? '_' : ch)).join('')

/** A packlog's file name, exactly as the backend names it on Drive. Safe for any OS. */
export const partFileName = (packlogId: string, part: 'label' | 'invoice' | 'source', awb: string): string =>
  // Characters Windows or macOS refuse in a file name, and control characters.
  [...`${packlogId}-${part}-${awb}.pdf`].map(ch => ('<>:"/\\|?*'.includes(ch) || ch.charCodeAt(0) < 32 ? '_' : ch)).join('')
