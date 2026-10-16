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
/** Label Sorting: the order a packlog's labels are worked through and downloaded in. */
export type PacklogSortKey = 'sku' | 'carrier' | 'distributionCode'
export const PACKLOG_SORT_KEYS: PacklogSortKey[] = ['sku', 'carrier', 'distributionCode']

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
  /** The order its labels are shown, packed and downloaded in; absent / null: sheet order. */
  sortKey?: PacklogSortKey | null
  /** Created from Label Sorting — listed there whatever its sort is now. */
  labelSorting?: boolean
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
  /**
   * The master SKU its SKU column maps to in the SKU Mapping table, set when
   * the packlog is created and refreshed when a new mapping is imported.
   * Absent / null: no mapping matched (or the packlog predates the feature).
   */
  masterSku?: string | null
  /**
   * Flipkart's distribution code (`B1`, `C1` …), read off the shipping label
   * when the PDFs are matched. Absent / null: none printed or none read.
   */
  distributionCode?: string | null
}

export interface CreatePacklogInput {
  packlogId: string
  platform: string
  scanMode: ScanMode
  orderFileName: string
  headers: string[]
  sortKey?: PacklogSortKey | null
  orders: { rowIndex: number; awb: string; awbRaw: string; rawRow: Record<string, string> }[]
}

export interface CleanupSummary {
  at: string
  packlogsDeleted: number
  filesDeleted: number
  foldersDeleted: number
  failed: number
}

/**
 * One record (sheet row) in a background extraction job.
 *   pending  waiting for its worker (grey)
 *   running  its worker is cutting it now (grey, outlined)
 *   done     every part it has is cut and attached (green)
 *   missing  no PDF page was found for its AWB (red)
 *   failed   cutting or saving failed (red)
 */
export type JobRecordStatus = 'pending' | 'running' | 'done' | 'missing' | 'failed'

export interface JobRecord {
  /** 1-based row of the order sheet (xlsx). */
  record: number
  awb: string
  orderId: string
  /** 1-based worker the record was dealt to (round-robin). */
  worker: number
  status: JobRecordStatus
  /** Parts to cut for this record: label and/or invoice. */
  parts: PartName[]
  /** Files written, once done. */
  files?: string[]
  /** Time its worker spent on it. */
  ms?: number
  error?: string
}

export type JobState = 'queued' | 'running' | 'finished' | 'cancelled' | 'interrupted'

export interface JobCounts {
  total: number
  done: number
  missing: number
  failed: number
}

/** A background extraction job, without its records — the list row. */
export interface ExtractionJobSummary {
  id: string
  /** The packlog's record id. */
  packlogObjectId: string
  /** Human id, e.g. SP-20260930-173516-5L1. */
  packlogId: string
  orderFileName: string
  platform: string
  workers: number
  state: JobState
  counts: JobCounts
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

/** The whole job, records included — the expanded row. */
export interface ExtractionJob extends ExtractionJobSummary {
  records: JobRecord[]
}

/** What the Settings page shows about Scan & Pack storage. */
export interface ScanPackSettingsState {
  /** The folder in use (resolved: the chosen one, or Downloads). */
  dir: string
  isDefaultDir: boolean
  weeksKept: number
  lastCleanup: CleanupSummary | null
  /** Parallel PDF extractors. */
  workers: number
}

/** One row of the `master-sku` table: a listing SKU and the master it ships as. */
export interface MasterSkuRecord {
  id: string
  listingSku: string
  masterSku: string
}

/** What the SKU Mapping dialog shows about the stored table. */
export interface MasterSkuSummary {
  /** Listing SKUs mapped. */
  total: number
  /** Distinct master SKUs. */
  masters: number
  /** The sheet the table was last imported from. */
  fileName: string | null
  updatedAt: string | null
}

/** What one mapping sheet did to the table. */
export interface MasterSkuMergeCounts extends MasterSkuSummary {
  /** New listing SKU → master SKU pairs. */
  added: number
  /** Listing SKUs moved to a different master SKU. */
  updated: number
  /** Pairs already in the table — not added again. */
  skipped: number
}

export interface MasterSkuImportResult extends MasterSkuMergeCounts {
  /** Packlog orders whose master SKU changed with this import. */
  ordersUpdated: number
}
