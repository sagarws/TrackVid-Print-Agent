export interface AgentPrinter {
  /** The name the OS prints by — what the web app sends back in a print job. */
  name: string
  /** What the OS shows people. Often the same as `name`; on macOS it is not. */
  displayName: string
  /** The OS default printer. False for all when none is set. */
  isDefault: boolean
}

export type ThemeMode = 'light' | 'dark' | 'system'

export type JobStatus = 'printing' | 'done' | 'failed'

export interface PrintJob {
  id: string
  /** The website that sent it, or "Test print" from this window. */
  source: string
  printer: string
  name: string
  status: JobStatus
  error?: string
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
  allowedOrigins: string[]
  /** The dev-only origins, shown read-only so it is clear why they work. */
  devOrigins: string[]
  openAtLogin: boolean
  themeMode: ThemeMode
  /** Where the agent writes its log, for support. */
  logPath: string | null
  jobs: PrintJob[]
}

/** Result of a call from the window that can fail with something to show. */
export type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string }
