import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { app } from 'electron'
import { AGENT_HOST, AGENT_PORT, API_PATHS, APP_NAME, MAX_REQUEST_BYTES } from '@shared/constants/agent'
import { isOriginAllowed } from '@shared/utils/origin'
import { submitJob } from './jobs'
import { logger } from './logger'
import { findPrinter, refreshPrinters } from './printers'
import { allowedOrigins, setServerStatus } from './state'

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

interface PrintRequest {
  printer: string
  pdfBase64: string
  jobName: string
}

const parsePrintRequest = (body: unknown): PrintRequest => {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Missing print job.')
  const { printer, pdfBase64, jobName } = body as Record<string, unknown>
  if (typeof printer !== 'string' || !printer.trim()) throw new HttpError(400, 'Name the printer to use.')
  if (typeof pdfBase64 !== 'string' || !pdfBase64) throw new HttpError(400, 'The job has no PDF.')
  return {
    printer,
    pdfBase64,
    jobName: typeof jobName === 'string' && jobName.trim() ? jobName.trim().slice(0, 120) : 'TrackVid print'
  }
}

const handlePrint = async (req: IncomingMessage, res: ServerResponse, origin: string): Promise<void> => {
  const job = parsePrintRequest(await readJson(req))

  if (!(await findPrinter(job.printer))) {
    throw new HttpError(404, `Printer "${job.printer}" is not installed on this computer.`)
  }

  const bytes = Buffer.from(job.pdfBase64, 'base64')
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new HttpError(400, 'The job is not a PDF.')
  }

  const result = await submitJob({ bytes, printer: job.printer, name: job.jobName, source: origin })
  if (result.status === 'failed') {
    sendJson(res, 502, { ok: false, jobId: result.id, error: result.error ?? 'The printer did not accept the job.' })
    return
  }
  sendJson(res, 200, { ok: true, jobId: result.id })
}

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) {
    sendJson(res, 403, { ok: false, error: 'Host not allowed.' })
    return
  }

  const origin = req.headers.origin
  const path = (req.url ?? '/').split('?')[0]
  const allowed = isOriginAllowed(origin, allowedOrigins())

  // The one endpoint that answers a browser whose origin is not on the list.
  if (path === API_PATHS.status && origin && (req.method === 'GET' || req.method === 'OPTIONS')) {
    setCors(req, res, origin)
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    sendJson(res, 200, { ok: true, app: APP_NAME, version: app.getVersion(), allowed })
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

  if (path === API_PATHS.printers && req.method === 'GET') {
    const printers = await refreshPrinters()
    sendJson(res, 200, { ok: true, printers })
    return
  }

  if (path === API_PATHS.print && req.method === 'POST') {
    await handlePrint(req, res, origin)
    return
  }

  sendJson(res, 404, { ok: false, error: 'Not found.' })
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
