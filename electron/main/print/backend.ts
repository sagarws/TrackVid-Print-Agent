import type {
  AgentPrinter,
  PrintFormat,
  PrintOptions,
  QueueJobState
} from '@shared/types/agent'

/**
 * What each OS provides. CUPS (macOS, Linux) and the Windows spooler differ in
 * every detail, and everything above this line is written once against it.
 */

export type PrinterSnapshot = AgentPrinter

export interface OsJob {
  state: QueueJobState
  reasons: string[]
  message?: string
}

export interface PrintBackend {
  /** Every printer with its live status, supplies and queue. */
  listPrinters(): Promise<PrinterSnapshot[]>
  /** One job's state in the OS queue; null once the OS no longer has it. */
  getJob(printer: string, osJobId: string): Promise<OsJob | null>
  /** Hand a file to the OS queue. Resolves once it is queued. */
  print(file: string, printer: string, title: string, format: PrintFormat, options?: PrintOptions): Promise<{ osJobId?: string }>
  cancelJob(printer: string, osJobId: string): Promise<void>
  /** Let a held job print. */
  releaseJob(printer: string, osJobId: string): Promise<void>
  /** Cancel every job in the printer's queue. */
  clearQueue(printer: string): Promise<void>
  /** Un-pause the queue and let it accept jobs again. */
  resumePrinter(printer: string): Promise<void>
}
