/**
 * The agent's public contract with the TrackVid web app.
 *
 * TrackVid-FE hard-codes the same port and paths (src/config/constant.ts,
 * PRINT_AGENT_*). Changing any value here without changing it there leaves
 * every packing bench falling back to the browser print dialog.
 */
export const APP_ID = 'com.trackvid.printagent'
export const APP_NAME = 'TrackVid Print Agent'

/** Loopback only. Never 0.0.0.0 — the agent must not be reachable from the LAN. */
export const AGENT_HOST = '127.0.0.1'
export const AGENT_PORT = 17865

export const API_PATHS = {
  status: '/v1/status',
  printers: '/v1/printers',
  print: '/v1/print',
  jobs: '/v1/jobs',
  events: '/v1/events'
} as const

/**
 * A "both" job for a big packlog is a label + invoice PDF of a few MB, and
 * base64 inflates that by a third. 40 MB of JSON is far beyond any real job and
 * still small enough that a runaway request cannot exhaust memory.
 */
export const MAX_REQUEST_BYTES = 40 * 1024 * 1024

/**
 * Websites that may print, always — there is no list to edit.
 *
 *   TrackVid itself, on its domain and every subdomain (https only), and
 *   anything served from this computer on any port: the web app's dev server
 *   (3000), its preview (8002), or wherever else it is run locally.
 *
 * The localhost entries mean any page a local program serves can print too.
 * That is accepted: a program already running on this computer can reach the
 * printers without the agent, so the agent adds nothing it could not do.
 */
export const ALLOWED_ORIGINS: readonly string[] = [
  'https://trackvid.in',
  'https://*.trackvid.in',
  'http://localhost:*',
  'http://127.0.0.1:*'
]

/** How many finished jobs the window keeps on screen. */
export const JOB_HISTORY_LIMIT = 100

/**
 * How often printers are re-checked (OS queue + a probe of each device). A
 * probe is one small request per printer, so every 10 s costs nothing, and a
 * printer switched off shows as offline within one poll.
 */
export const PRINTER_POLL_MS = 10_000

/** How often a queued job's state is read back from the OS until it finishes. */
export const JOB_POLL_MS = 1_500

/** Jobs whose bytes are kept for Reprint: the most recent, up to this much. */
export const REPRINT_CACHE = { maxJobs: 30, maxBytes: 150 * 1024 * 1024 } as const

export const WINDOW_DEFAULTS = { width: 1240, height: 800, minWidth: 1000, minHeight: 640 } as const
