import type { PrintFormat, PrintOptions } from '../types/agent'

/**
 * Checking a print request from the web app. Everything here ends up as an
 * argument to lp or SumatraPDF, so each value is held to a narrow shape:
 * never a shell, but a comma in a paper name would still smuggle a second
 * setting into SumatraPDF's `-print-settings`.
 */

export class RequestError extends Error {}

const PAGES = /^\d{1,4}(-\d{1,4})?(,\d{1,4}(-\d{1,4})?)*$/
const PAPER = /^[\w .-]{1,64}$/

export const parsePrintOptions = (raw: unknown): PrintOptions => {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new RequestError('options must be an object.')
  const value = raw as Record<string, unknown>
  const options: PrintOptions = {}

  if (value['copies'] !== undefined) {
    const copies = value['copies']
    if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > 99) {
      throw new RequestError('copies must be a whole number from 1 to 99.')
    }
    options.copies = copies
  }
  if (value['pages'] !== undefined) {
    const pages = typeof value['pages'] === 'string' ? value['pages'].replace(/\s+/g, '') : ''
    if (!PAGES.test(pages)) throw new RequestError('pages must look like "1-3,5".')
    options.pages = pages
  }
  if (value['orientation'] !== undefined) {
    if (value['orientation'] !== 'portrait' && value['orientation'] !== 'landscape') {
      throw new RequestError('orientation must be "portrait" or "landscape".')
    }
    options.orientation = value['orientation']
  }
  if (value['paperSize'] !== undefined) {
    const paper = value['paperSize']
    if (typeof paper !== 'string' || !PAPER.test(paper.trim())) {
      throw new RequestError('paperSize must be a paper name like "A4", "4x6" or "iso_a6_105x148mm".')
    }
    options.paperSize = paper.trim()
  }
  if (value['scale'] !== undefined) {
    if (value['scale'] !== 'fit' && value['scale'] !== 'shrink' && value['scale'] !== 'none') {
      throw new RequestError('scale must be "fit", "shrink" or "none".')
    }
    options.scale = value['scale']
  }
  if (value['duplex'] !== undefined) {
    if (value['duplex'] !== 'one-sided' && value['duplex'] !== 'long-edge' && value['duplex'] !== 'short-edge') {
      throw new RequestError('duplex must be "one-sided", "long-edge" or "short-edge".')
    }
    options.duplex = value['duplex']
  }
  if (value['color'] !== undefined) {
    if (typeof value['color'] !== 'boolean') throw new RequestError('color must be true or false.')
    options.color = value['color']
  }
  return options
}

export interface ParsedPrintRequest {
  printer: string
  format: PrintFormat
  bytes: Buffer
  jobName: string
  options: PrintOptions
  allowOffline: boolean
}

/**
 * POST /v1/print body:
 *   { printer, pdfBase64, jobName? }                          (the original form)
 *   { printer, format: 'pdf' | 'raw', data: base64, jobName?, options?, allowOffline? }
 *   { printer, format: 'raw', text: '^XA…^XZ' }               (raw printer language as text)
 */
export const parsePrintRequest = (body: unknown): ParsedPrintRequest => {
  if (!body || typeof body !== 'object') throw new RequestError('Missing print job.')
  const value = body as Record<string, unknown>
  const { printer, jobName } = value
  if (typeof printer !== 'string' || !printer.trim()) throw new RequestError('Name the printer to use.')

  const format = value['format'] ?? 'pdf'
  if (format !== 'pdf' && format !== 'raw') throw new RequestError('format must be "pdf" or "raw".')

  let bytes: Buffer
  const data = value['data'] ?? value['pdfBase64']
  if (typeof data === 'string' && data) bytes = Buffer.from(data, 'base64')
  else if (format === 'raw' && typeof value['text'] === 'string' && value['text']) bytes = Buffer.from(value['text'], 'utf8')
  else throw new RequestError(format === 'pdf' ? 'The job has no PDF.' : 'The job has no data.')

  if (bytes.length === 0) throw new RequestError('The job is empty.')
  if (format === 'pdf' && bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new RequestError('The job is not a PDF.')

  return {
    printer,
    format,
    bytes,
    jobName: typeof jobName === 'string' && jobName.trim() ? jobName.trim().slice(0, 120) : 'TrackVid print',
    options: parsePrintOptions(value['options']),
    allowOffline: value['allowOffline'] === true
  }
}
