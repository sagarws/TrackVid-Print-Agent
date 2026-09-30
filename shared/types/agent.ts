import type { ScanPackSettingsState } from './scanpack'

/**
 * What a printer is doing, as one word. Worked out from the OS queue (paused?
 * accepting jobs?) and, where it can be reached, from the device itself.
 */
export type PrinterState = 'ready' | 'printing' | 'paused' | 'offline' | 'error' | 'unknown'

/** How the computer reaches the printer — decides how "is it there?" is checked. */
export type PrinterConnection = 'network' | 'usb' | 'virtual' | 'unknown'

export type IssueSeverity = 'error' | 'warning' | 'info'

/** One thing the printer or the queue is complaining about. */
export interface PrinterIssue {
  /** The OS / IPP keyword, e.g. "media-empty-error". */
  code: string
  severity: IssueSeverity
  /** Plain words for a packer: "Out of paper". */
  message: string
}

export interface PrinterSupply {
  name: string
  /** 0–100, or null when the printer reports "some" / "unknown". */
  level: number | null
  /** CSS colour when the printer reports one ("#00FFFF"). */
  color?: string
}

export interface PrinterStatus {
  state: PrinterState
  /** One line for the card and the API: "Ready", "Out of paper", "Not on the network". */
  message: string
  issues: PrinterIssue[]
  /**
   * Did the device answer just now? true / false for a network or USB printer
   * the agent could check, null when it cannot tell (a virtual printer, or a
   * Windows port with no address).
   */
  reachable: boolean | null
  /** The OS queue takes new jobs. False when it has been told to reject them. */
  acceptingJobs: boolean
  /** When this status was read (ISO). */
  checkedAt: string
}

/** A job as the OS print queue holds it — including ones other apps sent. */
export type QueueJobState = 'pending' | 'held' | 'printing' | 'stopped' | 'cancelled' | 'aborted' | 'completed'

export interface QueueJob {
  /** The OS job id: CUPS job number or Windows spooler job id, as a string. */
  id: string
  name: string
  state: QueueJobState
  /** e.g. "job-hold-until-specified", "Error, Offline". */
  reasons: string[]
  user?: string
  createdAt?: string
  /** Set when this agent sent it: the agent's job id. */
  agentJobId?: string
}

export interface AgentPrinter {
  /** The name the OS prints by — what the web app sends back in a print job. */
  name: string
  /** What the OS shows people. Often the same as `name`; on macOS it is not. */
  displayName: string
  /** The OS default printer. False for all when none is set. */
  isDefault: boolean
  connection: PrinterConnection
  /** Driver / make and model, e.g. "L3250 Series - IPP Everywhere". */
  driver?: string
  location?: string
  /** Where the OS sends the jobs: a device URI (macOS) or port (Windows). */
  address?: string
  status: PrinterStatus
  /** Ink / toner / ribbon levels, when the printer reports them. */
  supplies: PrinterSupply[]
  /** Jobs waiting in or being printed from this printer's OS queue. */
  queue: QueueJob[]
}

export type ThemeMode = 'light' | 'dark' | 'system'

/**
 * An agent job's life:
 *   sending → queued → printing → done
 *                   ↘ held (waiting for someone to release it)
 * and failed / cancelled at any point. "done" means the OS finished handing the
 * job to the printer, not only that the queue took it.
 */
export type JobStatus = 'sending' | 'queued' | 'held' | 'printing' | 'done' | 'failed' | 'cancelled'

/** What the job's bytes are: a PDF to be rendered, or printer language sent as-is. */
export type PrintFormat = 'pdf' | 'raw'

export type PrintScale = 'fit' | 'shrink' | 'none'
export type PrintDuplex = 'one-sided' | 'long-edge' | 'short-edge'

/** The QZ Tray-style print settings the web app may send with a job. */
export interface PrintOptions {
  /** 1–99. */
  copies?: number
  /** "1-3,5". */
  pages?: string
  orientation?: 'portrait' | 'landscape'
  /** Paper name as the OS knows it: "A4", "4x6", "iso_a6_105x148mm". */
  paperSize?: string
  /** PDF only. Default "fit", as QZ Tray did. */
  scale?: PrintScale
  duplex?: PrintDuplex
  /** false prints in black and white. */
  color?: boolean
}

export interface PrintJob {
  id: string
  /** The website that sent it, or "Test print" / "Reprint" from this window. */
  source: string
  printer: string
  name: string
  format: PrintFormat
  status: JobStatus
  /** The OS queue's id for the job, once it was queued. */
  osJobId?: string
  /** Why it failed, or what it is waiting on ("Printer is offline"). */
  error?: string
  message?: string
  options?: PrintOptions
  /** The agent still holds the job's bytes, so it can be printed again. */
  canReprint: boolean
  startedAt: string
  finishedAt?: string
}

export type ServerStatus =
  | { state: 'starting' }
  | { state: 'listening'; host: string; port: number }
  | { state: 'failed'; error: string }

export interface AgentState {
  version: string
  platform: 'darwin' | 'win32' | 'linux'
  server: ServerStatus
  printers: AgentPrinter[]
  printersError?: string
  /** When the printer list was last read from the OS (ISO), null before the first read. */
  printersCheckedAt: string | null
  /** False in an `npm run dev` run: start-at-login is only offered when installed. */
  packaged: boolean
  /** Scan & Pack storage: folder in use, weeks kept, last cleanup. */
  scanPack: ScanPackSettingsState
  openAtLogin: boolean
  themeMode: ThemeMode
  /** Refuse jobs for a printer that is offline / paused instead of queueing them. */
  blockOfflinePrinters: boolean
  /** Desktop notifications when a printer needs attention or a job fails. */
  notifications: boolean
  /** Where the agent writes its log, for support. */
  logPath: string | null
  jobs: PrintJob[]
}

/** Result of a call from the window that can fail with something to show. */
export type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string }
