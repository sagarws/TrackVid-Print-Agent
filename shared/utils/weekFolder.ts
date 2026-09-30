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

/** Only folders this app names are ever deleted: `YYYY-MM-DD_to_YYYY-MM-DD`. */
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

/** A packlog's file name, exactly as the backend names it on Drive. Safe for any OS. */
export const partFileName = (packlogId: string, part: 'label' | 'invoice', awb: string): string =>
  // Characters Windows or macOS refuse in a file name, and control characters.
  [...`${packlogId}-${part}-${awb}.pdf`].map(ch => ('<>:"/\\|?*'.includes(ch) || ch.charCodeAt(0) < 32 ? '_' : ch)).join('')
