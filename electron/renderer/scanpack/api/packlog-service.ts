import type {
  PackStatus,
  ScanMode,
  ScanPackBatch,
  ScanPackOrder,
} from "../types/scanAndPack.types";

// Packlog client — ported from TrackVid-FE, where it calls TrackVid-BE's
// /packlog API. Here the same calls go to the agent's main process over IPC
// (electron/main/scanpack), which keeps the records on this computer and the
// PDFs in the folder chosen in Settings under `scan-and-pack/<week>/`.
//
// Every call resolves to the shape the screens already unwrap —
// `response.data.data` (axios response → backend envelope → payload) — so the
// ported pages read it unchanged.

// ---------------------------------------------------------------------------
// BE → FE adapters
//
// The BE persists Mongo documents keyed on `_id` with `label/invoiceS3Key`
// pointers. The FE rendering layer expects a `ScanPackBatch` shape (identity
// keyed on `id/batchId`, orders with a `mapping.labelPages/invoicePages` page
// index array). These helpers translate between the two so pages can keep
// their current props / grids untouched.
// ---------------------------------------------------------------------------

interface ServerPacklogSummary {
  _id: string;
  packlogId: string;
  platform: string;
  scanMode?: ScanMode;
  orderFileName: string;
  headers?: string[];
  totalOrders: number;
  mappedCount: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

interface ServerPacklogOrder {
  _id: string;
  packlogId: string;
  rowIndex: number;
  awb: string;
  awbRaw: string;
  rawRow?: Record<string, string>;
  /** Absolute paths of the stored PDFs on this computer, null until uploaded. */
  labelFile?: string | null;
  invoiceFile?: string | null;
  labelPageCount?: number;
  invoicePageCount?: number;
  mappedAt?: string | null;
  /**
   * Packing state. Optional on the wire on purpose: rows written before the
   * field existed carry neither key, and `adaptPacklogDetail` reads that
   * absence as "ready" rather than treating it as corrupt.
   */
  packStatus?: PackStatus;
  packedAt?: string | null;
}

interface ServerPacklogDetail {
  packlog: ServerPacklogSummary;
  orders: ServerPacklogOrder[];
}

/**
 * Summary → `ScanPackBatch` without orders (list rows don't need them).
 * `orders` stays empty; the batch-list page renders from the summary's
 * `totalOrders` / `mappedCount` via a separate BatchRow.
 */
export const adaptPacklogSummary = (s: ServerPacklogSummary): ScanPackBatch => ({
  id: String(s._id),
  batchId: s.packlogId,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  platform: s.platform,
  orderFileName: s.orderFileName,
  headers: s.headers ?? [],
  orders: [],
  documentNames: [],
  scanMode: s.scanMode,
});

/**
 * Detail → full `ScanPackBatch`. Order rows carry a synthetic `mapping`
 * whose `label/invoicePages` array length matches the server-reported page
 * count — the FE only reads `.length`, never the individual entries, so a
 * length-N zero-array is a faithful stand-in for the legacy IndexedDB shape.
 */
export const adaptPacklogDetail = (d: ServerPacklogDetail): ScanPackBatch => {
  const orders: ScanPackOrder[] = (d.orders ?? []).map((o) => {
    const hasLabel = Boolean(o.labelFile);
    const hasInvoice = Boolean(o.invoiceFile);
    return {
    id: String(o._id),
    rowIndex: o.rowIndex,
    awb: o.awb,
    awbRaw: o.awbRaw,
    raw: o.rawRow ?? {},
    mapping:
      hasLabel || hasInvoice
        ? {
            docId: String(o._id),
            labelPages: Array(o.labelPageCount ?? (hasLabel ? 1 : 0)).fill(0),
            invoicePages: Array(o.invoicePageCount ?? (hasInvoice ? 1 : 0)).fill(0),
          }
        : null,
    // Anything that is not literally "packed" is ready — an absent field on a
    // pre-existing row, and any value the server might add later that this
    // build does not know about, both land on the safe side.
    packStatus: o.packStatus === "packed" ? "packed" : "ready",
    packedAt: o.packedAt ?? null,
    };
  });
  return {
    ...adaptPacklogSummary(d.packlog),
    orders,
  };
};

/** Also exposed so pages can build lightweight row objects. */
export const summaryCounts = (s: ServerPacklogSummary) => ({
  totalOrders: s.totalOrders,
  mappedCount: s.mappedCount,
});

type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Unwrap an IPC result into the axios-style `{ data: { data } }` the pages read. */
const envelope = async <T>(call: Promise<IpcResult<T>>) => {
  const result = await call;
  // The web app's axios interceptor rejects with the server's message as a
  // string; the pages handle both that and an Error, so an Error is used here.
  if (!result.ok) throw new Error(result.error);
  return { data: { isSuccess: true, data: result.value } };
};

const api = () => window.printAgent.scanPack;

export interface CreatePacklogOrderPayload {
  rowIndex: number;
  awb: string;
  awbRaw: string;
  rawRow: Record<string, string>;
}

export interface CreatePacklogPayload {
  packlogId: string;
  platform: string;
  scanMode: ScanMode;
  orderFileName: string;
  headers: string[];
  orders: CreatePacklogOrderPayload[];
}

const createPacklog = (payload: CreatePacklogPayload) => envelope(api().create(payload));

const listPacklogs = (opts: { page?: number; limit?: number; platform?: string } = {}) =>
  envelope(api().list(opts));

const getPacklog = (id: string) => envelope(api().get(id));

const deletePacklog = (id: string) => envelope(api().remove(id));

/**
 * Save one part (label OR invoice) for one order. `bytes` is the sliced PDF
 * produced by `buildOrderPdf(order, part)`; the main process writes it to
 * `<folder>/scan-and-pack/<week>/<packlogId>-<part>-<awb>.pdf`.
 */
const uploadPart = (
  packlogObjectId: string,
  orderObjectId: string,
  part: "label" | "invoice",
  bytes: Uint8Array,
  pageCount: number,
  _awb: string
) => envelope(api().upload(packlogObjectId, orderObjectId, part, bytes, pageCount));

/** A stored PDF as raw bytes, for the preview and the print flow. */
const downloadPart = async (
  packlogObjectId: string,
  orderObjectId: string,
  part: "label" | "invoice"
): Promise<ArrayBuffer> => {
  const result = await api().download(packlogObjectId, orderObjectId, part);
  if (!result.ok) throw new Error(result.error);
  const bytes = result.value;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

/** Mark one order packed. Idempotent: a second call keeps the first `packedAt`. */
const markPacked = (packlogObjectId: string, orderObjectId: string) =>
  envelope(api().markPacked(packlogObjectId, orderObjectId));

export const PacklogService = {
  createPacklog,
  listPacklogs,
  getPacklog,
  deletePacklog,
  uploadPart,
  downloadPart,
  markPacked,
};
