import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { ParseSpeeds, PDFDocument } from 'pdf-lib'
import type {
  CreatePacklogInput,
  PageRef,
  PartName,
  StoredPacklog,
  StoredPacklogOrder
} from '@shared/types/scanpack'
import { pageList } from '@shared/utils/pageList'
import { partFileName, ROOT_FOLDER_NAME, weekRangeFor } from '@shared/utils/weekFolder'
import { logger } from '../logger'
import { printPerf, since } from './perf'
import { getSettings } from '../settings'

/**
 * Scan & Pack's local "backend": the same operations TrackVid-BE's
 * packlog.service.ts offers, with the records in the app's data folder and the
 * PDFs in the folder chosen in Settings instead of Mongo and Google Drive.
 *
 *   records  <userData>/scanpack/<_id>.json   one file per packlog
 *   PDFs     <chosen folder>/scan-and-pack/<week>/<packlogId>-<part>-<awb>.pdf
 *
 * Every packlog is held in memory once loaded, and written back shortly after
 * it changes (coalesced: a burst of scans is one write), plus on quit.
 */

/** Rows one packlog may hold — the backend's PACKLOG_MAX_ORDERS. */
export const PACKLOG_MAX_ORDERS = 5000

interface Entry {
  packlog: StoredPacklog
  orders: StoredPacklogOrder[]
}

export class ScanPackError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
  }
}

const notFound = () => new ScanPackError('This packlog no longer exists.', 'packlog_not_found')

const recordsDir = (): string => join(app.getPath('userData'), 'scanpack')

/** The folder in use: the one chosen in Settings, or Downloads. */
export const storageRoot = (): string => getSettings().scanPackDir ?? app.getPath('downloads')

/** An id shaped like a Mongo ObjectId, as the ported screens expect. */
const newId = (): string => randomBytes(12).toString('hex')

let entries: Map<string, Entry> | null = null
const dirty = new Set<string>()
let flushTimer: NodeJS.Timeout | null = null

const load = (): Map<string, Entry> => {
  if (entries) return entries
  entries = new Map()
  const dir = recordsDir()
  mkdirSync(dir, { recursive: true })
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      const entry = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Entry
      if (entry?.packlog?._id) entries.set(entry.packlog._id, entry)
    } catch (error) {
      logger.warn(`[scanpack] skipped unreadable record ${name}`, error)
    }
  }
  return entries
}

const writeEntry = (entry: Entry): void => {
  const file = join(recordsDir(), `${entry.packlog._id}.json`)
  const temp = `${file}.tmp`
  // Write-then-rename: a crash mid-write never leaves half a record.
  writeFileSync(temp, JSON.stringify(entry))
  renameSync(temp, file)
}

/** Write every changed packlog now. Called on a short timer and on quit. */
export const flushScanPack = (): void => {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  const all = load()
  for (const id of dirty) {
    const entry = all.get(id)
    try {
      if (entry) writeEntry(entry)
    } catch (error) {
      logger.error(`[scanpack] could not save packlog ${id}`, error)
    }
  }
  dirty.clear()
}

const markDirty = (id: string): void => {
  dirty.add(id)
  if (!flushTimer) flushTimer = setTimeout(flushScanPack, 300)
}

const get = (id: string): Entry => {
  const entry = load().get(id)
  if (!entry) throw notFound()
  return entry
}

const isMapped = (o: StoredPacklogOrder) => Boolean(o.labelFile || o.invoiceFile || o.labelRef || o.invoiceRef)

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const createPacklog = (input: CreatePacklogInput) => {
  const all = load()
  // Idempotent on packlogId, as the backend is: a retry returns the same one.
  for (const entry of all.values()) {
    if (entry.packlog.packlogId === input.packlogId) {
      return {
        id: entry.packlog._id,
        packlogId: entry.packlog.packlogId,
        ordersCount: entry.orders.length,
        orders: entry.orders.map(o => ({ rowIndex: o.rowIndex, awb: o.awb, id: o._id })),
        skipped: []
      }
    }
  }

  if (input.orders.length > PACKLOG_MAX_ORDERS) {
    throw new ScanPackError(
      `Too many rows in one packlog. Split the sheet into files of ${PACKLOG_MAX_ORDERS} rows or fewer.`,
      'too_many_orders'
    )
  }

  // Same rule as the backend: no AWB → never matchable; a repeated AWB keeps
  // its first row only.
  const seen = new Set<string>()
  const skipped: { rowIndex: number; awb: string; reason: 'missing_awb' | 'duplicate_awb' }[] = []
  const rows = input.orders.filter(o => {
    if (!o?.awb || !o?.awbRaw) {
      skipped.push({ rowIndex: o?.rowIndex, awb: o?.awb ?? '', reason: 'missing_awb' })
      return false
    }
    if (seen.has(o.awb)) {
      skipped.push({ rowIndex: o.rowIndex, awb: o.awb, reason: 'duplicate_awb' })
      return false
    }
    seen.add(o.awb)
    return true
  })

  const now = new Date()
  const week = weekRangeFor(now)
  const packlog: StoredPacklog = {
    _id: newId(),
    packlogId: input.packlogId,
    platform: input.platform,
    scanMode: input.scanMode,
    orderFileName: input.orderFileName,
    headers: input.headers,
    totalOrders: rows.length,
    mappedCount: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    weekStart: week.weekStart,
    weekEnd: week.weekEnd
  }
  const orders: StoredPacklogOrder[] = rows.map(o => ({
    _id: newId(),
    packlogId: packlog._id,
    rowIndex: o.rowIndex,
    awb: o.awb,
    awbRaw: o.awbRaw,
    rawRow: o.rawRow ?? {},
    labelFile: null,
    invoiceFile: null,
    mappedAt: null,
    packStatus: 'ready',
    packedAt: null
  }))

  const entry = { packlog, orders }
  all.set(packlog._id, entry)
  writeEntry(entry)

  return {
    id: packlog._id,
    packlogId: packlog.packlogId,
    ordersCount: orders.length,
    orders: orders.map(o => ({ rowIndex: o.rowIndex, awb: o.awb, id: o._id })),
    skipped
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const listPacklogs = (opts: { page?: number; limit?: number; platform?: string }) => {
  const page = Math.max(1, Math.floor(Number(opts.page)) || 1)
  const limit = Math.min(100, Math.max(1, Math.floor(Number(opts.limit)) || 20))
  const items = [...load().values()]
    .map(entry => entry.packlog)
    .filter(p => !opts.platform || p.platform === opts.platform)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { items: items.slice((page - 1) * limit, page * limit), total: items.length, page, limit }
}

export const getPacklog = (id: string) => {
  const entry = get(id)
  return { packlog: entry.packlog, orders: [...entry.orders].sort((a, b) => a.rowIndex - b.rowIndex) }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export const uploadPart = async (
  id: string,
  orderId: string,
  part: PartName,
  bytes: Buffer,
  pageCount: number
) => {
  const entry = get(id)
  const order = entry.orders.find(o => o._id === orderId)
  if (!order) throw new ScanPackError('That order is not in this packlog.', 'order_not_found')
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new ScanPackError('The file is not a PDF.', 'not_pdf')
  }

  const record = `For record ${order.rowIndex + 1} (${order.awb})`
  const week = weekRangeFor(new Date(entry.packlog.createdAt))
  const folder = join(storageRoot(), ROOT_FOLDER_NAME, week.folderName)
  let start = performance.now()
  await mkdir(folder, { recursive: true })
  const mkdirMs = since(start)
  const file = join(folder, partFileName(entry.packlog.packlogId, part, order.awb))
  start = performance.now()
  await writeFile(file, bytes)
  const writeMs = since(start)

  // A re-upload (remapping) replaces the previous file for this part.
  const previous = part === 'label' ? order.labelFile : order.invoiceFile
  if (previous && previous !== file) await rm(previous, { force: true })
  printPerf([
    `${record} ${mkdirMs} ms taken in save-${part}: create week folder`,
    `${record} ${writeMs} ms taken in save-${part}: write ${Math.round(bytes.length / 1024)} KB to disk`
  ])

  const wasMapped = isMapped(order)
  if (part === 'label') {
    order.labelFile = file
    order.labelPageCount = pageCount
  } else {
    order.invoiceFile = file
    order.invoicePageCount = pageCount
  }
  order.mappedAt ??= new Date().toISOString()
  if (!wasMapped) entry.packlog.mappedCount += 1
  entry.packlog.updatedAt = new Date().toISOString()
  markDirty(id)

  return { file, pageCount }
}

const readStored = async (file: string, part: PartName): Promise<Buffer> => {
  try {
    return await readFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ScanPackError(
        `The ${part} PDF was moved or deleted from ${file}. Re-upload the packlog to print it.`,
        'file_missing'
      )
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Source PDFs + page maps (no per-order PDFs are cut at upload)
// ---------------------------------------------------------------------------

/**
 * Save one uploaded label/invoice PDF, once, in the packlog's week folder:
 * `<packlogId>-source-<n>.pdf`. Saving the same docId again replaces it.
 */
export const saveSource = async (id: string, docId: string, name: string, bytes: Buffer, pageCount: number) => {
  const entry = get(id)
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new ScanPackError('The file is not a PDF.', 'not_pdf')
  }
  const sources = (entry.packlog.sources ??= [])
  const existing = sources.find(s => s.docId === docId)
  const n = existing ? sources.indexOf(existing) + 1 : sources.length + 1
  const week = weekRangeFor(new Date(entry.packlog.createdAt))
  const folder = join(storageRoot(), ROOT_FOLDER_NAME, week.folderName)
  const start = performance.now()
  await mkdir(folder, { recursive: true })
  const file = join(folder, partFileName(entry.packlog.packlogId, 'source', String(n)))
  await writeFile(file, bytes)
  const writeMs = since(start)
  if (existing) Object.assign(existing, { file, name, pageCount })
  else sources.push({ docId, file, name, pageCount })
  entry.packlog.updatedAt = new Date().toISOString()
  // Written now, not coalesced: the page map that follows points into it.
  writeEntry(entry)
  dirty.delete(id)
  printPerf([`${writeMs} ms taken in save source PDF ${n} (${Math.round(bytes.length / 1024)} KB, ${pageCount} pages) → ${file}`])
  return { file }
}

/** Point each order at its pages of a source PDF. One call for the whole upload. */
export const mapOrders = (
  id: string,
  maps: { orderId: string; docId: string; labelPages: number[]; invoicePages: number[] }[]
) => {
  const entry = get(id)
  const sources = new Set((entry.packlog.sources ?? []).map(s => s.docId))
  const byId = new Map(entry.orders.map(o => [o._id, o]))
  let mapped = 0
  for (const map of maps) {
    const order = byId.get(map.orderId)
    if (!order || !sources.has(map.docId)) continue
    const valid = (pages: number[]) => pages.filter(p => Number.isInteger(p) && p >= 0)
    const label = valid(map.labelPages)
    const invoice = valid(map.invoicePages)
    if (label.length) order.labelRef = { docId: map.docId, pages: label }
    if (invoice.length) order.invoiceRef = { docId: map.docId, pages: invoice }
    if (label.length || invoice.length) {
      order.mappedAt ??= new Date().toISOString()
      mapped++
    }
  }
  entry.packlog.mappedCount = entry.orders.filter(isMapped).length
  entry.packlog.updatedAt = new Date().toISOString()
  writeEntry(entry)
  dirty.delete(id)
  return { mapped, mappedCount: entry.packlog.mappedCount }
}

type Located = { kind: 'file'; file: string } | { kind: 'ref'; file: string; pages: number[] }

const locate = (entry: Entry, order: StoredPacklogOrder, part: PartName): Located | null => {
  const own = part === 'label' ? order.labelFile : order.invoiceFile
  if (own) return { kind: 'file', file: own }
  const ref: PageRef | null | undefined = part === 'label' ? order.labelRef : order.invoiceRef
  if (!ref) return null
  const source = entry.packlog.sources?.find(s => s.docId === ref.docId)
  if (!source) throw new ScanPackError('The source PDF for this order is missing from the packlog.', 'file_missing')
  return { kind: 'ref', file: source.file, pages: ref.pages }
}

const orderIn = (entry: Entry, orderId: string) => {
  const order = entry.orders.find(o => o._id === orderId)
  if (!order) throw new ScanPackError('That order is not in this packlog.', 'order_not_found')
  return order
}

/**
 * What to send to the printer for these parts of one order: the file's bytes
 * and, for a source PDF, the page list to print from it. Label + invoice from
 * the same source become one job with both pages.
 */
export const printable = async (id: string, orderId: string, parts: PartName[]) => {
  const entry = get(id)
  const order = orderIn(entry, orderId)
  const located = parts.map(part => ({ part, at: locate(entry, order, part) }))
  const missing = located.find(l => !l.at)
  if (missing) throw new ScanPackError(`This order has no ${missing.part} mapped — nothing to print.`, 'part_missing')
  const all = located.map(l => l.at!)
  const first = all[0]!
  if (all.length === 1 || all.every(a => a.kind === 'ref' && a.file === first.file)) {
    const pages = first.kind === 'ref' ? pageList(all.flatMap(a => (a.kind === 'ref' ? a.pages : []))) : undefined
    return [{ bytes: await readStored(first.file, parts[0]!), ...(pages ? { pages } : {}) }]
  }
  // Separate files: one job each, in order.
  return Promise.all(
    all.map(async (a, i) => ({
      bytes: await readStored(a.file, parts[i]!),
      ...(a.kind === 'ref' ? { pages: pageList(a.pages) } : {})
    }))
  )
}

/**
 * The parsed source for on-demand cutting (preview / download): kept for the
 * last file only, keyed by path + size so a replaced file is re-read.
 */
let parsed: { key: string; doc: Promise<PDFDocument> } | null = null

const cutPages = async (file: string, pages: number[], part: PartName): Promise<Buffer> => {
  const bytes = await readStored(file, part)
  const key = `${file}:${bytes.length}`
  if (parsed?.key !== key) {
    parsed = { key, doc: PDFDocument.load(bytes, { parseSpeed: ParseSpeeds.Fastest }) }
    parsed.doc.catch(() => {
      parsed = null
    })
  }
  const source = await parsed.doc
  const out = await PDFDocument.create()
  const valid = pages.filter(p => p < source.getPageCount())
  if (!valid.length) throw new ScanPackError('The mapped pages are missing from the source PDF.', 'file_missing')
  for (const page of await out.copyPages(source, valid)) out.addPage(page)
  return Buffer.from(await out.save())
}

/** One order's part as its own PDF — for the preview and the Download button. */
export const downloadPart = async (id: string, orderId: string, part: PartName): Promise<Buffer> => {
  const entry = get(id)
  const at = locate(entry, orderIn(entry, orderId), part)
  if (!at) throw new ScanPackError(`This order has no ${part} PDF.`, 'part_missing')
  return at.kind === 'file' ? readStored(at.file, part) : cutPages(at.file, at.pages, part)
}

// ---------------------------------------------------------------------------
// Pack
// ---------------------------------------------------------------------------

/** Idempotent, as on the backend: a second call keeps the first packedAt. */
export const markPacked = (id: string, orderId: string) => {
  const entry = get(id)
  const order = entry.orders.find(o => o._id === orderId)
  if (!order) throw new ScanPackError('That order is not in this packlog.', 'order_not_found')
  if (order.packStatus === 'packed' && order.packedAt) {
    return { packStatus: 'packed' as const, packedAt: order.packedAt, alreadyPacked: true }
  }
  order.packStatus = 'packed'
  order.packedAt = new Date().toISOString()
  entry.packlog.updatedAt = order.packedAt
  markDirty(id)
  return { packStatus: 'packed' as const, packedAt: order.packedAt, alreadyPacked: false }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

const deleteFiles = (entry: Entry): { deleted: number; failed: number } => {
  let deleted = 0
  let failed = 0
  const files = [
    ...entry.orders.flatMap(order => [order.labelFile, order.invoiceFile]),
    ...(entry.packlog.sources ?? []).map(source => source.file)
  ]
  {
    for (const file of files) {
      if (!file) continue
      try {
        if (existsSync(file)) {
          rmSync(file, { force: true })
          deleted++
        }
      } catch (error) {
        failed++
        logger.warn(`[scanpack] could not delete ${file}`, error)
      }
    }
  }
  return { deleted, failed }
}

const dropEntry = (id: string): void => {
  load().delete(id)
  dirty.delete(id)
  rmSync(join(recordsDir(), `${id}.json`), { force: true })
}

export const deletePacklog = (id: string): void => {
  const entry = get(id)
  deleteFiles(entry)
  dropEntry(id)
}

/** For the retention job: every packlog, and a way to remove one with its files. */
export const allPacklogs = (): StoredPacklog[] => [...load().values()].map(entry => entry.packlog)

export const removePacklogWithFiles = (id: string): { deleted: number; failed: number } => {
  const entry = load().get(id)
  if (!entry) return { deleted: 0, failed: 0 }
  const result = deleteFiles(entry)
  dropEntry(id)
  return result
}
