import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { app } from 'electron'
import { AGENT_HOST, AGENT_PORT, API_PATHS, APP_NAME, MAX_REQUEST_BYTES, PRINTER_POLL_MS } from '@shared/constants/agent'
import type { AgentPrinter, AgentState, PrintJob } from '@shared/types/agent'
import { isOriginAllowed } from '@shared/utils/origin'
import { parsePrintRequest, RequestError } from '@shared/utils/printRequest'
import { cancelJob, getJob, listJobs, submitJob } from './jobs'
import { logger } from './logger'
import { blocksPrinting } from './print/status'
import { findPrinter, freshPrinters, refreshPrinters } from './printers'
import { allowedOrigins, getPrinters, setServerStatus, snapshot, subscribe } from './state'

/**
 * The local HTTP API the web app calls. Listens on 127.0.0.1 only.
 *
 * WHO MAY CALL IT, checked on every request:
 *
 *   Host    must be 127.0.0.1:<port> or localhost:<port>. Stops DNS
 *           rebinding: a hostile page that points its own domain at 127.0.0.1
 *           still sends its own domain in Host.
 *   Origin  must be on the allowed-websites list. Browsers set it and pages
 *           cannot forge it, so an unrelated website the packer has open
 *           cannot print. A request with no Origin (curl, another program) is
 *           refused too — nothing but a browser has a reason to call this.
 *
 * The single exception is GET /v1/status, which answers any browser origin
 * with `allowed: false|true` and nothing else. That lets the web app say
 * "this site is not on the agent's list" instead of a vague "not reachable",
 * at the cost of letting a page learn the agent is installed.
 *
 * A POST with a JSON body is never a "simple" request, so the browser sends a
 * preflight first and a disallowed origin is stopped before any body is read.
 */

const ALLOWED_HOSTS = new Set([`${AGENT_HOST}:${AGENT_PORT}`, `localhost:${AGENT_PORT}`])

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  })
  res.end(payload)
}

const setCors = (req: IncomingMessage, res: ServerResponse, origin: string): void => {
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Max-Age', '600')
    // Chrome's Private Network Access preflight, for a public https page
    // calling a loopback address.
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
    }
  }
}

const readJson = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const type = req.headers['content-type'] ?? ''
    if (!type.toLowerCase().startsWith('application/json')) {
      reject(new HttpError(415, 'Send the job as application/json.'))
      return
    }
    const declared = Number(req.headers['content-length'] ?? 0)
    if (declared > MAX_REQUEST_BYTES) {
      reject(new HttpError(413, 'The print job is too large.'))
      return
    }

    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_REQUEST_BYTES) {
        reject(new HttpError(413, 'The print job is too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new HttpError(400, 'The request body is not valid JSON.'))
      }
    })
    req.on('error', reject)
  })

/** What the web app sees of a printer. The OS queue's own entries stay private. */
const publicPrinter = (printer: AgentPrinter) => ({
  name: printer.name,
  displayName: printer.displayName,
  isDefault: printer.isDefault,
  connection: printer.connection,
  ...(printer.driver ? { driver: printer.driver } : {}),
  ...(printer.location ? { location: printer.location } : {}),
  status: printer.status,
  supplies: printer.supplies,
  queuedJobs: printer.queue.length
})

/** A job, for the website that sent it. */
const publicJob = (job: PrintJob): Omit<PrintJob, 'canReprint' | 'source'> => {
  const copy: Partial<PrintJob> = { ...job }
  delete copy.canReprint
  delete copy.source
  return copy as Omit<PrintJob, 'canReprint' | 'source'>
}

const handlePrint = async (req: IncomingMessage, res: ServerResponse, origin: string): Promise<void> => {
  let job: ReturnType<typeof parsePrintRequest>
  try {
    job = parsePrintRequest(await readJson(req))
  } catch (error) {
    if (error instanceof RequestError) throw new HttpError(400, error.message)
    throw error
  }

  const printer = await findPrinter(job.printer)
  if (!printer) throw new HttpError(404, `Printer "${job.printer}" is not installed on this computer.`)

  const result = await submitJob({
    bytes: job.bytes,
    printer: job.printer,
    name: job.jobName,
    source: origin,
    format: job.format,
    options: job.options,
    allowOffline: job.allowOffline
  })
  const current = getPrinters().find(entry => entry.name === job.printer) ?? printer
  if (result.status === 'failed') {
    sendJson(res, blocksPrinting(current.status) ? 409 : 502, {
      ok: false,
      jobId: result.id,
      error: result.error ?? 'The printer did not accept the job.',
      printer: publicPrinter(current)
    })
    return
  }
  sendJson(res, 200, { ok: true, jobId: result.id, job: publicJob(result), printer: publicPrinter(current) })
}

/**
 * GET /v1/events — Server-Sent Events, the push version of polling:
 *   event: printers   data: [printer, …]   whenever any printer's status changes
 *   event: job        data: job            whenever one of this website's jobs changes
 * EventSource reconnects by itself; the first message is always the full list.
 */
const handleEvents = (req: IncomingMessage, res: ServerResponse, origin: string): void => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  })
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  let printersJson = ''
  const jobsJson = new Map<string, string>()
  const push = (state: AgentState, initial = false) => {
    const printers = JSON.stringify(state.printers.map(publicPrinter))
    if (printers !== printersJson) {
      printersJson = printers
      res.write(`event: printers\ndata: ${printers}\n\n`)
    }
    for (const job of state.jobs) {
      if (job.source !== origin) continue
      const json = JSON.stringify(publicJob(job))
      if (jobsJson.get(job.id) === json) continue
      jobsJson.set(job.id, json)
      // Jobs from before the page connected are history, not news.
      if (!initial) send('job', publicJob(job))
    }
  }
  push(snapshot(), true)
  const unsubscribe = subscribe(state => push(state))
  // A comment every 25 s keeps proxies and sleeping laptops from dropping the stream.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000)
  req.on('close', () => {
    unsubscribe()
    clearInterval(heartbeat)
  })
}

const PRINTER_PATH = /^\/v1\/printers\/([^/]+)$/
const JOB_PATH = /^\/v1\/jobs\/([^/]+)(\/cancel)?$/

const route = async (req: IncomingMessage, res: ServerResponse, origin: string, path: string, query: URLSearchParams) => {
  if (path === API_PATHS.printers && req.method === 'GET') {
    const printers = query.get('refresh') === '1' ? await refreshPrinters() : await freshPrinters(PRINTER_POLL_MS)
    sendJson(res, 200, { ok: true, printers: printers.map(publicPrinter) })
    return
  }

  const printerMatch = PRINTER_PATH.exec(path)
  if (printerMatch?.[1] && req.method === 'GET') {
    const name = decodeURIComponent(printerMatch[1])
    const printers = query.get('refresh') === '1' ? await refreshPrinters() : await freshPrinters(PRINTER_POLL_MS)
    const printer = printers.find(entry => entry.name === name)
    if (!printer) throw new HttpError(404, `Printer "${name}" is not installed on this computer.`)
    sendJson(res, 200, { ok: true, printer: publicPrinter(printer) })
    return
  }

  if (path === API_PATHS.print && req.method === 'POST') {
    await handlePrint(req, res, origin)
    return
  }

  if (path === API_PATHS.jobs && req.method === 'GET') {
    sendJson(res, 200, { ok: true, jobs: listJobs().filter(job => job.source === origin).map(publicJob) })
    return
  }

  const jobMatch = JOB_PATH.exec(path)
  if (jobMatch?.[1]) {
    const job = getJob(decodeURIComponent(jobMatch[1]))
    // Another website's job is "not found", not "forbidden": no hint it exists.
    if (!job || job.source !== origin) throw new HttpError(404, 'No such job.')
    if (!jobMatch[2] && req.method === 'GET') {
      sendJson(res, 200, { ok: true, job: publicJob(job) })
      return
    }
    if (jobMatch[2] && req.method === 'POST') {
      try {
        sendJson(res, 200, { ok: true, job: publicJob(await cancelJob(job.id)) })
      } catch (error) {
        throw new HttpError(409, error instanceof Error ? error.message : 'Could not cancel the job.')
      }
      return
    }
  }

  if (path === API_PATHS.events && req.method === 'GET') {
    handleEvents(req, res, origin)
    return
  }

  sendJson(res, 404, { ok: false, error: 'Not found.' })
}

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) {
    sendJson(res, 403, { ok: false, error: 'Host not allowed.' })
    return
  }

  const origin = req.headers.origin
  const url = new URL(req.url ?? '/', `http://${AGENT_HOST}`)
  const path = url.pathname
  const allowed = isOriginAllowed(origin, allowedOrigins())

  // The one endpoint that answers a browser whose origin is not on the list.
  if (path === API_PATHS.status && origin && (req.method === 'GET' || req.method === 'OPTIONS')) {
    setCors(req, res, origin)
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    sendJson(res, 200, { ok: true, app: APP_NAME, version: app.getVersion(), allowed, apiVersion: 2 })
    return
  }

  if (!origin || !allowed) {
    sendJson(res, 403, { ok: false, error: 'This website is not allowed to print through the TrackVid Print Agent.' })
    return
  }

  setCors(req, res, origin)
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  await route(req, res, origin, path, url.searchParams)
}

let server: Server | null = null

export const startServer = (): void => {
  if (server) return
  setServerStatus({ state: 'starting' })

  server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Unexpected error.'
      if (status >= 500) logger.error('Request failed', { url: req.url, error: message })
      if (!res.headersSent) sendJson(res, status, { ok: false, error: message })
      else res.end()
    })
  })

  server.on('error', (error: NodeJS.ErrnoException) => {
    const message =
      error.code === 'EADDRINUSE'
        ? `Port ${AGENT_PORT} is already in use by another program. Close it and restart the agent.`
        : error.message
    logger.error('Server error', error)
    setServerStatus({ state: 'failed', error: message })
  })

  server.listen(AGENT_PORT, AGENT_HOST, () => {
    logger.info(`Listening on http://${AGENT_HOST}:${AGENT_PORT}`)
    setServerStatus({ state: 'listening', host: AGENT_HOST, port: AGENT_PORT })
  })
}

export const stopServer = (): Promise<void> =>
  new Promise(resolve => {
    if (!server) {
      resolve()
      return
    }
    server.close(() => resolve())
    server.closeAllConnections()
    server = null
  })
