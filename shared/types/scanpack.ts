/**
 * Scan & Pack records as the agent stores them — the same fields TrackVid-BE
 * keeps in Mongo (Packlog / PacklogOrder), so the screens ported from
 * TrackVid-FE read them through the same adapters.
 *
 * WHERE AN ORDER'S PDF IS — two shapes:
 *   labelRef / invoiceRef   pages of the packlog's source PDF (current). The
 *                           source is saved once per packlog; nothing is cut
 *                           at upload, and a print sends the source with a
 *                           page range.
 *   labelFile / invoiceFile a PDF of its own (packlogs saved before that, and
 *                           Bulk Update top-ups). Still read and printed.
 */
export type ScanMode = 'label' | 'invoice' | 'both'
export type PackStatus = 'ready' | 'packed'
export type PartName = 'label' | 'invoice'

export interface StoredPacklog {
  _id: string
  packlogId: string
  platform: string
  scanMode: ScanMode
  orderFileName: string
  headers: string[]
  totalOrders: number
  mappedCount: number
  createdAt: string
  updatedAt: string
  /** The IST week the packlog was created in; its files live in that folder. */
  weekStart: string
  weekEnd: string
  /** The uploaded label/invoice PDFs, saved once each in the week folder. */
  sources?: StoredSource[]
}

export interface StoredSource {
  /** The id the upload screen gave the document (`<packlogId>:doc:<n>`). */
  docId: string
  /** Absolute path of the saved copy. */
  file: string
  /** The operator's original file name, for display. */
  name: string
  pageCount: number
}

/** An order's part as pages of a source PDF. Page indices are 0-based. */
export interface PageRef {
  docId: string
  pages: number[]
}

export interface StoredPacklogOrder {
  _id: string
  packlogId: string
  rowIndex: number
  awb: string
  awbRaw: string
  rawRow: Record<string, string>
  labelFile: string | null
  invoiceFile: string | null
  labelRef?: PageRef | null
  invoiceRef?: PageRef | null
  labelPageCount?: number
  invoicePageCount?: number
  mappedAt: string | null
  packStatus: PackStatus
  packedAt: string | null
}

export interface CreatePacklogInput {
  packlogId: string
  platform: string
  scanMode: ScanMode
  orderFileName: string
  headers: string[]
  orders: { rowIndex: number; awb: string; awbRaw: string; rawRow: Record<string, string> }[]
}

export interface CleanupSummary {
  at: string
  packlogsDeleted: number
  filesDeleted: number
  foldersDeleted: number
  failed: number
}

/** What the Settings page shows about Scan & Pack storage. */
export interface ScanPackSettingsState {
  /** The folder in use (resolved: the chosen one, or Downloads). */
  dir: string
  isDefaultDir: boolean
  weeksKept: number
  lastCleanup: CleanupSummary | null
}
