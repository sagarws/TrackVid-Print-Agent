/**
 * Scan & Pack records as the agent stores them — the same fields TrackVid-BE
 * keeps in Mongo (Packlog / PacklogOrder), so the screens ported from
 * TrackVid-FE read them through the same adapters. `labelFile` /
 * `invoiceFile` replace the backend's Drive file ids: absolute paths on disk.
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
