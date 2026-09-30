import { request as httpRequest, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { userInfo } from 'node:os'

/**
 * A minimal IPP client (RFC 8010/8011): just enough to ask a printer — or the
 * local CUPS scheduler — what state it is in, and what jobs it holds.
 *
 * WHY NOT ipptool. It has no JSON output, its text output is meant for people,
 * and it cannot talk to CUPS over its local socket without a URI dance. IPP is
 * a small binary format over an HTTP POST; encoding it here keeps every answer
 * structured and costs no extra process per question.
 *
 * Only reads go through here. Anything that changes CUPS (cancel, resume,
 * release) goes through the CUPS command-line tools, which carry the local
 * authentication CUPS asks for.
 */

export const IPP_OP = {
  cancelJob: 0x0008,
  getJobAttributes: 0x0009,
  getJobs: 0x000a,
  getPrinterAttributes: 0x000b,
  /** CUPS extension: every queue on this computer, in one answer. */
  cupsGetPrinters: 0x4002
} as const

const TAG = {
  operationAttributes: 0x01,
  endOfAttributes: 0x03,
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  begCollection: 0x34,
  endCollection: 0x37,
  textWithoutLanguage: 0x41,
  nameWithoutLanguage: 0x42,
  keyword: 0x44,
  uri: 0x45,
  charset: 0x47,
  naturalLanguage: 0x48
} as const

export type IppValue = string | number | boolean | null
export type IppAttributes = Record<string, IppValue[]>

export interface IppResponse {
  /** 0x0000–0x00ff is success; anything else is an IPP error status. */
  status: number
  /** One entry per attribute group, in order (printer group, then each job group…). */
  groups: { tag: number; attributes: IppAttributes }[]
}

type RequestAttribute = { tag: number; name: string; values: (string | number | boolean)[] }

const encodeValue = (tag: number, value: string | number | boolean): Buffer => {
  if (tag === TAG.integer || tag === TAG.enum) {
    const buffer = Buffer.alloc(4)
    buffer.writeInt32BE(Number(value))
    return buffer
  }
  if (tag === TAG.boolean) return Buffer.from([value ? 1 : 0])
  return Buffer.from(String(value), 'utf8')
}

export const encodeRequest = (operation: number, requestId: number, attributes: RequestAttribute[]): Buffer => {
  const parts: Buffer[] = []
  const header = Buffer.alloc(8)
  header.writeInt8(1, 0) // IPP/1.1: everything from CUPS to a cheap label printer speaks it
  header.writeInt8(1, 1)
  header.writeUInt16BE(operation, 2)
  header.writeUInt32BE(requestId, 4)
  parts.push(header, Buffer.from([TAG.operationAttributes]))

  for (const attribute of attributes) {
    attribute.values.forEach((value, index) => {
      const name = Buffer.from(index === 0 ? attribute.name : '', 'utf8')
      const encoded = encodeValue(attribute.tag, value)
      const head = Buffer.alloc(3)
      head.writeUInt8(attribute.tag, 0)
      head.writeUInt16BE(name.length, 1)
      const length = Buffer.alloc(2)
      length.writeUInt16BE(encoded.length)
      parts.push(head, name, length, encoded)
    })
  }
  parts.push(Buffer.from([TAG.endOfAttributes]))
  return Buffer.concat(parts)
}

const decodeValue = (tag: number, value: Buffer): IppValue => {
  // Out-of-band values (unsupported, unknown, no-value) carry no data.
  if (tag >= 0x10 && tag <= 0x1f) return null
  if ((tag === TAG.integer || tag === TAG.enum) && value.length === 4) return value.readInt32BE(0)
  if (tag === TAG.boolean && value.length === 1) return value[0] === 1
  // textWithLanguage / nameWithLanguage: 2-byte language length, language, 2-byte text length, text.
  if (tag === 0x35 || tag === 0x36) {
    const languageLength = value.readUInt16BE(0)
    const textLength = value.readUInt16BE(2 + languageLength)
    return value.subarray(4 + languageLength, 4 + languageLength + textLength).toString('utf8')
  }
  if (tag >= 0x40 && tag <= 0x5f) return value.toString('utf8')
  // dateTime, resolution, rangeOfInteger, octetString: nothing here reads them.
  return null
}

export const decodeResponse = (data: Buffer): IppResponse => {
  if (data.length < 9) throw new Error('The IPP response is too short.')
  const status = data.readUInt16BE(2)
  const groups: IppResponse['groups'] = []
  let current: IppAttributes | null = null
  let lastName = ''
  // Collections (media-col and friends) are walked past, not decoded.
  let depth = 0
  let offset = 8

  while (offset < data.length) {
    const tag = data.readUInt8(offset)
    offset += 1
    if (tag === TAG.endOfAttributes) break
    if (tag <= 0x0f) {
      current = {}
      groups.push({ tag, attributes: current })
      continue
    }
    const nameLength = data.readUInt16BE(offset)
    offset += 2
    const name = data.subarray(offset, offset + nameLength).toString('utf8')
    offset += nameLength
    const valueLength = data.readUInt16BE(offset)
    offset += 2
    const value = data.subarray(offset, offset + valueLength)
    offset += valueLength
    if (offset > data.length) throw new Error('The IPP response is truncated.')

    if (tag === TAG.begCollection) {
      if (depth === 0 && current) {
        if (name) lastName = name
        ;(current[lastName] ??= []).push(null)
      }
      depth += 1
      continue
    }
    if (tag === TAG.endCollection) {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth > 0 || !current) continue

    if (name) lastName = name
    ;(current[lastName] ??= []).push(decodeValue(tag, value))
  }
  return { status, groups }
}

/** Where to send the request: a printer on the network, or the local CUPS socket. */
export type IppTarget = { url: string } | { socketPath: string }

const LOCAL_CUPS_SOCKET = process.platform === 'darwin' ? '/private/var/run/cupsd' : '/run/cups/cups.sock'

export const localCups: IppTarget = { socketPath: LOCAL_CUPS_SOCKET }

let requestId = 0

export const ippRequest = (
  target: IppTarget,
  path: string,
  operation: number,
  attributes: RequestAttribute[],
  timeoutMs = 3_000
): Promise<IppResponse> =>
  new Promise((resolve, reject) => {
    requestId = (requestId % 0x7fffffff) + 1
    const body = encodeRequest(operation, requestId, attributes)
    const headers = { 'Content-Type': 'application/ipp', 'Content-Length': body.length }

    let send: typeof httpRequest = httpRequest
    let options: RequestOptions & { rejectUnauthorized?: boolean }
    if ('socketPath' in target) {
      options = { socketPath: target.socketPath, path, method: 'POST', headers: { ...headers, Host: 'localhost' } }
    } else {
      const url = new URL(target.url)
      const secure = url.protocol === 'ipps:' || url.protocol === 'https:'
      send = secure ? httpsRequest : httpRequest
      options = {
        host: url.hostname,
        port: url.port || 631,
        path,
        method: 'POST',
        headers,
        // Printers ship self-signed certificates; the connection is only ever
        // asked for its state, and nothing secret is sent over it.
        ...(secure ? { rejectUnauthorized: false } : {})
      }
    }

    const req = send(options, res => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        if ((res.statusCode ?? 0) !== 200) {
          reject(new Error(`The printer answered HTTP ${res.statusCode ?? '?'}.`))
          return
        }
        try {
          resolve(decodeResponse(Buffer.concat(chunks)))
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
      res.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('The printer did not answer in time.')))
    req.on('error', reject)
    req.end(body)
  })

/** The operation attributes every request starts with. */
export const baseAttributes = (uriName: 'printer-uri' | 'job-uri', uri: string): RequestAttribute[] => [
  { tag: TAG.charset, name: 'attributes-charset', values: ['utf-8'] },
  { tag: TAG.naturalLanguage, name: 'attributes-natural-language', values: ['en'] },
  { tag: TAG.uri, name: uriName, values: [uri] },
  { tag: TAG.nameWithoutLanguage, name: 'requesting-user-name', values: [userInfo().username] }
]

export const requested = (...names: string[]): RequestAttribute => ({
  tag: TAG.keyword,
  name: 'requested-attributes',
  values: names
})

export const keyword = (name: string, ...values: string[]): RequestAttribute => ({ tag: TAG.keyword, name, values })

export const integer = (name: string, value: number): RequestAttribute => ({ tag: TAG.integer, name, values: [value] })

export const isIppSuccess = (response: IppResponse): boolean => response.status < 0x0100

/** First value of an attribute, as a string / number, or undefined. */
export const str = (attributes: IppAttributes, name: string): string | undefined => {
  const value = attributes[name]?.[0]
  return typeof value === 'string' ? value : undefined
}
export const num = (attributes: IppAttributes, name: string): number | undefined => {
  const value = attributes[name]?.[0]
  return typeof value === 'number' ? value : undefined
}
export const strs = (attributes: IppAttributes, name: string): string[] =>
  (attributes[name] ?? []).filter((value): value is string => typeof value === 'string')
export const nums = (attributes: IppAttributes, name: string): number[] =>
  (attributes[name] ?? []).filter((value): value is number => typeof value === 'number')
