import type {
  IssueSeverity,
  PrinterIssue,
  PrinterState,
  PrinterStatus,
  PrinterSupply,
  QueueJobState
} from '@shared/types/agent'

/**
 * Turning what the OS and the printer report into something a packer can act
 * on. Pure functions, so the rules are tested without a printer.
 */

/** IPP printer-state-reasons keywords (RFC 8011 §5.4.12, PWG 5100.x) in plain words. */
const REASON_TEXT: Record<string, string> = {
  paused: 'Paused on this computer — press Resume',
  offline: 'Printer is offline',
  'connecting-to-device': 'Cannot reach the printer',
  'timed-out': 'Printer stopped answering',
  shutdown: 'Printer is shutting down',
  'media-empty': 'Out of paper',
  'media-needed': 'Load paper',
  'media-low': 'Paper is running low',
  'media-jam': 'Paper jam',
  'input-tray-missing': 'Paper tray is missing',
  'output-tray-missing': 'Output tray is missing',
  'output-area-full': 'Output tray is full',
  'output-area-almost-full': 'Output tray is almost full',
  'door-open': 'A door is open',
  'cover-open': 'The cover is open',
  'interlock-open': 'A cover or latch is open',
  'toner-empty': 'Out of toner',
  'toner-low': 'Toner is low',
  'marker-supply-empty': 'Out of ink',
  'marker-supply-low': 'Ink is low',
  'marker-waste-full': 'Ink waste tank is full',
  'marker-waste-almost-full': 'Ink waste tank is almost full',
  'developer-empty': 'Developer is empty',
  'fuser-over-temp': 'Fuser too hot',
  'fuser-under-temp': 'Printer is warming up',
  'spool-area-full': 'Printer memory is full',
  'stopped-partly': 'Printer is partly stopped',
  stopping: 'Printer is stopping',
  'moving-to-paused': 'Printer is pausing',
  'cups-missing-filter': 'The printer driver is missing a filter',
  'cups-insecure-filter': 'The printer driver is blocked by macOS',
  'cups-waiting-for-job-completed': 'Finishing a job',
  'hold-new-jobs': 'Holding new jobs',
  'printer-not-reachable': 'Not on the network — check it is on and on this Wi-Fi',
  'printer-not-attached': 'Not connected — check the USB cable and that it is on'
}

/** Reasons that are bookkeeping, not problems. */
const IGNORED_REASONS = new Set(['none', 'cups-waiting-for-job-completed', 'com.apple.print.recoverable'])

/** Reasons that mean the device cannot be reached, whatever their suffix. */
const OFFLINE_REASONS = new Set([
  'offline',
  'connecting-to-device',
  'timed-out',
  'shutdown',
  'printer-not-reachable',
  'printer-not-attached'
])

const titleCase = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** "media-empty-error" → { code, severity: error, message: "Out of paper" }. */
export const describeReason = (raw: string): PrinterIssue | null => {
  const code = raw.trim()
  if (!code || IGNORED_REASONS.has(code)) return null
  const suffix = /-(error|warning|report)$/.exec(code)?.[1]
  const base = suffix ? code.slice(0, -(suffix.length + 1)) : code
  // Vendor reasons ("com.epson.ink-low") and CUPS ones keep their own wording.
  const text = REASON_TEXT[base] ?? titleCase(base.replace(/^[a-z]+\.[a-z]+\./i, '').replace(/[-_.]+/g, ' '))

  let severity: IssueSeverity
  if (base === 'paused' || OFFLINE_REASONS.has(base)) severity = 'error'
  else if (suffix === 'error') severity = 'error'
  else if (suffix === 'warning') severity = 'warning'
  else if (suffix === 'report') severity = 'info'
  // IPP says a bare keyword is an error; CUPS and printers use bare ones for
  // warnings ("toner-low") too, so only the obviously blocking ones stay errors.
  else severity = /empty|jam|open|missing|full$|needed/.test(base) && !/almost/.test(base) ? 'error' : 'warning'

  return { code, severity, message: text }
}

export const describeReasons = (reasons: string[]): PrinterIssue[] => {
  const seen = new Set<string>()
  const issues: PrinterIssue[] = []
  for (const reason of reasons) {
    const issue = describeReason(reason)
    if (!issue || seen.has(issue.message)) continue
    seen.add(issue.message)
    issues.push(issue)
  }
  const rank: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 }
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity])
}

const isOfflineIssue = (issue: PrinterIssue): boolean =>
  OFFLINE_REASONS.has(issue.code.replace(/-(error|warning|report)$/, ''))

export interface StatusInput {
  /** IPP printer-state: 3 idle, 4 processing, 5 stopped. Undefined when not known. */
  ippState?: number
  reasons: string[]
  acceptingJobs: boolean
  reachable: boolean | null
  /** The queue is paused on this computer (CUPS disabled / Windows paused). */
  paused: boolean
}

const STATE_MESSAGE: Record<PrinterState, string> = {
  ready: 'Ready',
  printing: 'Printing',
  paused: 'Paused on this computer',
  offline: 'Printer is offline',
  error: 'Needs attention',
  unknown: 'Status unknown'
}

export const deriveStatus = (input: StatusInput, checkedAt = new Date()): PrinterStatus => {
  const reasons = [...input.reasons]
  if (input.paused && !reasons.includes('paused')) reasons.unshift('paused')
  if (input.reachable === false && !reasons.some(reason => /^(offline-report|printer-not-)/.test(reason))) {
    reasons.unshift('printer-not-reachable')
  }
  const issues = describeReasons(reasons)
  const errors = issues.filter(issue => issue.severity === 'error')

  let state: PrinterState
  if (input.reachable === false || errors.some(isOfflineIssue)) state = 'offline'
  else if (input.paused) state = 'paused'
  else if (errors.length || input.ippState === 5) state = 'error'
  else if (input.ippState === 4) state = 'printing'
  else if (input.ippState === 3 || input.reachable === true) state = 'ready'
  else state = 'unknown'

  if (!input.acceptingJobs && state !== 'offline') state = 'paused'

  const headline =
    state === 'offline'
      ? (errors.find(isOfflineIssue) ?? errors[0])
      : state === 'paused'
        ? (errors.find(issue => issue.code === 'paused') ?? errors[0])
        : state === 'error'
          ? errors[0]
          : undefined

  return {
    state,
    message: headline?.message ?? (!input.acceptingJobs ? 'Not accepting jobs' : STATE_MESSAGE[state]),
    issues,
    reachable: input.reachable,
    acceptingJobs: input.acceptingJobs,
    checkedAt: checkedAt.toISOString()
  }
}

/** Is the printer in a state where a new job would only sit in the queue? */
export const blocksPrinting = (status: PrinterStatus): boolean =>
  status.state === 'offline' || status.state === 'paused' || !status.acceptingJobs

/**
 * IPP marker-* attributes → supplies. Levels: 0–100, or -1 / -2 / -3 for
 * "none / unknown / some", which are shown as unknown.
 */
export const parseSupplies = (names: string[], levels: number[], colors: string[]): PrinterSupply[] =>
  names.map((name, index) => {
    const level = levels[index]
    // "#00FFFF#FF00FF" is a multi-colour cartridge; the first colour stands for it.
    const color = /^#[0-9a-f]{6}/i.exec(colors[index] ?? '')?.[0]
    return {
      name,
      level: typeof level === 'number' && level >= 0 ? Math.min(100, level) : null,
      ...(color ? { color } : {})
    }
  })

/** IPP job-state enum → queue state. */
export const ippJobState = (value: number | undefined, reasons: string[] = []): QueueJobState => {
  switch (value) {
    case 3:
      return 'pending'
    case 4:
      return 'held'
    case 5:
      return 'printing'
    case 6:
      return 'stopped'
    case 7:
      return 'cancelled'
    case 8:
      return 'aborted'
    case 9:
      return 'completed'
    default:
      return reasons.includes('job-hold-until-specified') ? 'held' : 'pending'
  }
}
