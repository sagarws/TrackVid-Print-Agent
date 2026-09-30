/**
 * Scan & Pack — client-side types.
 *
 * The whole module currently runs in the browser: sheets are parsed with
 * SheetJS, label/invoice PDFs are scanned with pdf.js + ZXing, and everything
 * is persisted in IndexedDB. No backend contract is involved yet, so these
 * types are the single source of truth for the stored shape.
 */

/** Row-order preserving map of sheet header -> cell value (always a string). */
export type SheetRow = Record<string, string>;

/** Which pages of which uploaded PDF carry this order's label / invoice. */
export interface OrderDocumentMapping {
  /** `ScanPackDocument.id` the pages belong to. */
  docId: string;
  /** 0-based page indices (pdf-lib page indices) of the shipping label. */
  labelPages: number[];
  /** 0-based page indices of the tax invoice that follows the label. */
  invoicePages: number[];
}

/**
 * Where a shipment is in the packing flow.
 *
 * `ready` is the resting state every order starts in — the BE column defaults
 * to it and a legacy row that predates the field is read as `ready` too, so
 * nothing has to be backfilled. `packed` is set exactly once, the first time a
 * label/invoice is successfully sent to a printer (by scan or by the manual
 * Print button). A reprint never moves it back or forward.
 */
export type PackStatus = "ready" | "packed";

export interface ScanPackOrder {
  /** Stable row identity inside the batch — also the DataGrid row id. */
  id: string;
  /** 0-based index of the row in the originally uploaded sheet. */
  rowIndex: number;
  /** Raw sheet row, keyed by the original headers. */
  raw: SheetRow;
  /** Normalised Forward AWB used for matching (uppercase, separators stripped). */
  awb: string;
  /** Forward AWB exactly as it appeared in the sheet. */
  awbRaw: string;
  mapping: OrderDocumentMapping | null;
  packStatus: PackStatus;
  /** ISO timestamp of the first successful print; null while `ready`. */
  packedAt: string | null;
}

export interface ScanPackDocument {
  id: string;
  batchId: string;
  name: string;
  platform: string;
  uploadedAt: string;
  /** Raw PDF bytes. Kept in its own object store so the batch list stays light. */
  bytes: ArrayBuffer;
}

/**
 * What parts of each shipment the operator asked the scanner to pair with the
 * orders. `both` is the default and produces the historical behaviour; `label`
 * drops the invoice pages (label-only packing); `invoice` drops the label pages
 * (rarely used, meant for "print invoice only" workflows). Absent = `both`
 * for existing batches created before this field was introduced.
 */
export type ScanMode = "label" | "invoice" | "both";

export interface ScanPackBatch {
  /** Internal key — same value as `batchId`, kept separate for clarity. */
  id: string;
  /** Human-facing batch id shown in the grid, e.g. `SP-20260821-4F2A`. */
  batchId: string;
  createdAt: string;
  updatedAt: string;
  platform: string;
  orderFileName: string;
  /** Sheet headers in their original order. */
  headers: string[];
  orders: ScanPackOrder[];
  /** Names of every label/invoice PDF fed into this batch (initial + bulk updates). */
  documentNames: string[];
  /**
   * Which parts the scanner was asked to capture. Missing → treat as `both`
   * (old batches created before this field was added).
   */
  scanMode?: ScanMode;
}

/** Result of scanning one uploaded label/invoice PDF. */
export interface ScannedLabel {
  awb: string;
  labelPages: number[];
  invoicePages: number[];
}

export interface ScanReport {
  docId: string;
  fileName: string;
  totalPages: number;
  labels: ScannedLabel[];
  /** Pages that looked like a label but yielded no readable AWB. */
  unreadablePages: number[];
  /** AWBs that appeared more than once in the same PDF. */
  duplicateAwbs: string[];
}
