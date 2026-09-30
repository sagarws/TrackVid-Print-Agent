import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PrintFormat, PrintOptions, QueueJob } from '@shared/types/agent'
import type { OsJob, PrintBackend, PrinterSnapshot } from './backend'
import { readDefaultPrinter } from './defaultPrinter'
import {
  baseAttributes,
  IPP_OP,
  ippRequest,
  isIppSuccess,
  keyword,
  localCups,
  num,
  nums,
  requested,
  str,
  strs,
  type IppAttributes
} from './ipp'
import { connectionFromUri, listUsbDevices, probeDeviceUri } from './probe'
import { deriveStatus, ippJobState, parseSupplies } from './status'

const run = promisify(execFile)

/**
 * macOS and Linux: everything goes through CUPS.
 *
 *   Reading  IPP over the CUPS local socket — printers, their queues, one job.
 *            No password: CUPS answers the logged-in user's own questions.
 *   Changing The CUPS tools (lp, cancel, cupsenable). They carry the local
 *            credentials CUPS asks for before it changes a queue, and fail with
 *            a readable message when the user is not allowed to.
 */

const bin = (name: string, dir: 'bin' | 'sbin'): string => (process.platform === 'darwin' ? `/usr/${dir}/${name}` : name)

/** English output, whatever the Mac's language — some of it is parsed. */
const cupsTool = (name: string, dir: 'bin' | 'sbin', args: string[]) =>
  run(bin(name, dir), args, { timeout: 30_000, env: { ...process.env, LC_ALL: 'C' } })

const PRINTER_ATTRIBUTES = [
  'printer-name',
  'printer-info',
  'printer-location',
  'printer-make-and-model',
  'device-uri',
  'printer-state',
  'printer-state-reasons',
  'printer-is-accepting-jobs',
  'printer-type',
  'marker-names',
  'marker-levels',
  'marker-colors'
]

const JOB_ATTRIBUTES = [
  'job-id',
  'job-name',
  'job-state',
  'job-state-reasons',
  'job-printer-uri',
  'job-originating-user-name',
  'time-at-creation'
]

const printerFromUri = (uri: string | undefined): string | undefined => {
  const segment = uri?.split('/printers/')[1] ?? uri?.split('/classes/')[1]
  return segment ? decodeURIComponent(segment.split(/[/?]/)[0] ?? '') : undefined
}

const toQueueJob = (job: IppAttributes): QueueJob & { printer?: string } => {
  const reasons = strs(job, 'job-state-reasons').filter(reason => reason !== 'none')
  const created = num(job, 'time-at-creation')
  const user = str(job, 'job-originating-user-name')
  const printer = printerFromUri(str(job, 'job-printer-uri'))
  return {
    id: String(num(job, 'job-id') ?? '?'),
    name: str(job, 'job-name') || 'Untitled',
    state: ippJobState(num(job, 'job-state'), reasons),
    reasons,
    ...(user ? { user } : {}),
    ...(created ? { createdAt: new Date(created * 1000).toISOString() } : {}),
    ...(printer ? { printer } : {})
  }
}

const OFFLINE_REASON = /^(offline-report|connecting-to-device|timed-out)/

const listPrinters = async (): Promise<PrinterSnapshot[]> => {
  const [printersResponse, jobsResponse, defaultName, usbDevices] = await Promise.all([
    ippRequest(localCups, '/', IPP_OP.cupsGetPrinters, [
      ...baseAttributes('printer-uri', 'ipp://localhost/'),
      requested(...PRINTER_ATTRIBUTES)
    ]),
    ippRequest(localCups, '/', IPP_OP.getJobs, [
      ...baseAttributes('printer-uri', 'ipp://localhost/'),
      keyword('which-jobs', 'not-completed'),
      requested(...JOB_ATTRIBUTES)
    ]),
    readDefaultPrinter(),
    listUsbDevices()
  ])
  // CUPS answers "not found" when there are simply no printers.
  if (!isIppSuccess(printersResponse) && printersResponse.status !== 0x0406) {
    throw new Error(`CUPS refused the printer list (IPP status 0x${printersResponse.status.toString(16)}).`)
  }

  const jobs = isIppSuccess(jobsResponse)
    ? jobsResponse.groups.filter(group => group.tag === 0x02).map(group => toQueueJob(group.attributes))
    : []

  const printers = printersResponse.groups.filter(group => group.tag === 0x04).map(group => group.attributes)

  return Promise.all(
    printers.map(async attributes => {
      const name = str(attributes, 'printer-name') ?? '?'
      const uri = str(attributes, 'device-uri')
      const cupsReasons = strs(attributes, 'printer-state-reasons')
      const probe = uri ? await probeDeviceUri(uri, usbDevices) : { reachable: null, reasons: [], supplies: [] }

      // The device answering beats CUPS's memory of the last job's failure.
      const queueReasons = probe.reachable === true ? cupsReasons.filter(reason => !OFFLINE_REASON.test(reason)) : cupsReasons
      const paused = cupsReasons.includes('paused')
      const ippState = probe.ippState ?? num(attributes, 'printer-state')
      const status = deriveStatus({
        ...(ippState !== undefined ? { ippState } : {}),
        reasons: [...queueReasons.filter(reason => reason !== 'paused'), ...probe.reasons],
        acceptingJobs: attributes['printer-is-accepting-jobs']?.[0] !== false,
        reachable: probe.reachable,
        paused
      })

      const cupsSupplies = parseSupplies(
        strs(attributes, 'marker-names'),
        nums(attributes, 'marker-levels'),
        strs(attributes, 'marker-colors')
      )
      const driver = str(attributes, 'printer-make-and-model')
      const location = str(attributes, 'printer-location')
      // CUPS printer-type bit 0x20000 is "the server default"; lpstat -d also
      // honours the user's own default from lpoptions.
      const isDefault = defaultName ? name === defaultName : ((num(attributes, 'printer-type') ?? 0) & 0x20000) !== 0

      return {
        name,
        displayName: str(attributes, 'printer-info') || name,
        isDefault,
        connection: connectionFromUri(uri),
        ...(driver ? { driver } : {}),
        ...(location ? { location } : {}),
        ...(uri ? { address: uri } : {}),
        status,
        supplies: probe.supplies.length ? probe.supplies : cupsSupplies,
        queue: jobs
          .filter(job => job.printer === name)
          .map(({ printer: _printer, ...job }) => job)
      }
    })
  )
}

const getJob = async (_printer: string, osJobId: string): Promise<OsJob | null> => {
  const response = await ippRequest(localCups, `/jobs/${osJobId}`, IPP_OP.getJobAttributes, [
    ...baseAttributes('job-uri', `ipp://localhost/jobs/${osJobId}`),
    requested('job-state', 'job-state-reasons', 'job-printer-state-message')
  ])
  if (response.status === 0x0406) return null
  const job = response.groups.find(group => group.tag === 0x02)?.attributes
  if (!isIppSuccess(response) || !job) return null
  const reasons = strs(job, 'job-state-reasons').filter(reason => reason !== 'none')
  const message = str(job, 'job-printer-state-message')
  return { state: ippJobState(num(job, 'job-state'), reasons), reasons, ...(message ? { message } : {}) }
}

/** `lp` arguments for one job. Exported for the tests. */
export const lpArgs = (file: string, printer: string, title: string, format: PrintFormat, options: PrintOptions = {}): string[] => {
  const args = ['-d', printer, '-t', title]
  if (options.copies && options.copies > 1) args.push('-n', String(options.copies))

  if (format === 'raw') {
    // Printer language (ZPL, EPL, ESC/POS) goes to the device untouched.
    args.push('-o', 'raw')
  } else {
    const scale = options.scale ?? 'fit'
    // fit-to-page is what QZ Tray did by default, so a label PDF a little
    // larger than the stock still lands on it whole.
    if (scale === 'fit') args.push('-o', 'fit-to-page')
    else args.push('-o', `print-scaling=${scale === 'shrink' ? 'auto-fit' : 'none'}`)
    if (options.pages) args.push('-P', options.pages)
    if (options.orientation === 'landscape') args.push('-o', 'landscape')
    if (options.orientation === 'portrait') args.push('-o', 'orientation-requested=3')
    if (options.paperSize) args.push('-o', `media=${options.paperSize}`)
    if (options.duplex) {
      const sides = { 'one-sided': 'one-sided', 'long-edge': 'two-sided-long-edge', 'short-edge': 'two-sided-short-edge' }
      args.push('-o', `sides=${sides[options.duplex]}`)
    }
    if (options.color === false) args.push('-o', 'print-color-mode=monochrome')
  }
  args.push('--', file)
  return args
}

/** "request id is Epson_L3250-32 (1 file(s))" → "32". */
export const parseLpJobId = (stdout: string): string | undefined => /request id is .+-(\d+)\b/.exec(stdout)?.[1]

const print: PrintBackend['print'] = async (file, printer, title, format, options) => {
  // execFile, never a shell: the printer name comes from the network request
  // (checked against the OS list first, but still never interpolated).
  const { stdout } = await cupsTool('lp', 'bin', lpArgs(file, printer, title, format, options))
  const osJobId = parseLpJobId(stdout)
  return osJobId ? { osJobId } : {}
}

export const cupsBackend: PrintBackend = {
  listPrinters,
  getJob,
  print,
  cancelJob: async (_printer, osJobId) => {
    await cupsTool('cancel', 'bin', [osJobId])
  },
  releaseJob: async (_printer, osJobId) => {
    await cupsTool('lp', 'bin', ['-i', osJobId, '-H', 'resume'])
  },
  clearQueue: async printer => {
    await cupsTool('cancel', 'bin', ['-a', printer])
  },
  resumePrinter: async printer => {
    await cupsTool('cupsenable', 'sbin', [printer])
    await cupsTool('cupsaccept', 'sbin', [printer])
  }
}
