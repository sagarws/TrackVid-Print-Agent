/**
 * Order-sheet parsing for Scan & Pack.
 *
 * Accepts the CSV/XLSX the operator exports from the marketplace panel and
 * turns it into ordered headers + string rows.
 *
 * Cells are read from their *stored* value, never from the cached display text.
 * Excel and Google Sheets keep a 12-digit AWB in a General-format column as a
 * number whose display text is "1.68544E+11"; trusting that text silently turns
 * every long AWB into an unmatchable string.
 */
import * as XLSX from "xlsx";
import type { SheetRow } from "../../types/scanAndPack.types";
import { normaliseAwb } from "./platforms";

/**
 * Column names, in priority order, that can carry the forward AWB. The
 * template's own name ("Awb Number") comes first; older sheets used
 * "Forward AWB", still accepted.
 */
const AWB_HEADER_CANDIDATES = [
  "awb number",
  "forward awb",
  "forwardawb",
  "awb",
  "awb no",
  "tracking id",
  "tracking number",
];

export interface ParsedSheet {
  headers: string[];
  rows: SheetRow[];
  /** Header that was used as the AWB source, or null when none was found. */
  awbHeader: string | null;
}

/** Header comparison is case- and whitespace-insensitive. */
const canonical = (h: string) => h.toLowerCase().replace(/[\s_]+/g, " ").trim();

export const findAwbHeader = (headers: string[]): string | null => {
  for (const candidate of AWB_HEADER_CANDIDATES) {
    const hit = headers.find((h) => canonical(h) === candidate);
    if (hit) return hit;
  }
  // Last resort: any header that merely mentions AWB (e.g. "Forward AWB (Ekart)").
  return headers.find((h) => canonical(h).includes("awb")) ?? null;
};

/**
 * First header from the sheet whose canonical name matches one of `names`.
 * Comparison is case- and whitespace-insensitive, so `"Listing SKU"`,
 * `"listing_sku"` and `"LISTING  SKU"` all collide.
 */
export const findHeader = (headers: string[], names: string[]): string | null => {
  const wanted = new Set(names.map(canonical));
  return headers.find((h) => wanted.has(canonical(h))) ?? null;
};

/**
 * One cell -> the text the operator sees in the source column.
 *
 * Numbers are rendered from `cell.v` so identifiers keep every digit; only
 * dates fall back to the cached display text, where Excel's own format is
 * exactly what the operator expects to read back.
 */
const cellToString = (cell: XLSX.CellObject | undefined): string => {
  if (!cell || cell.v === undefined || cell.v === null) return "";

  if (cell.t === "n" && typeof cell.v === "number") {
    if (!Number.isFinite(cell.v)) return "";
    // BigInt never falls back to exponent notation the way String(1e21) does.
    return Number.isInteger(cell.v) ? BigInt(cell.v).toString() : String(cell.v);
  }

  if (cell.t === "d" || cell.v instanceof Date) {
    if (cell.w) return cell.w.trim();
    return cell.v instanceof Date ? cell.v.toISOString() : String(cell.v);
  }

  if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";

  return String(cell.v).trim();
};

export const parseOrderSheet = async (file: File): Promise<ParsedSheet> => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The uploaded file has no sheets.");

  const sheet = workbook.Sheets[sheetName];
  const ref = sheet?.["!ref"];
  if (!sheet) throw new Error("The uploaded file has no sheets.");
  if (!ref) throw new Error("The uploaded file is empty.");

  const range = XLSX.utils.decode_range(ref);
  const readCell = (row: number, col: number) =>
    cellToString(sheet[XLSX.utils.encode_cell({ r: row, c: col })] as XLSX.CellObject | undefined);

  // Header row: keep the operator's original column order, and stop at the
  // first gap so trailing empty columns do not become blank headers.
  const headers: string[] = [];
  const headerCols: number[] = [];
  for (let col = range.s.c; col <= range.e.c; col++) {
    const value = readCell(range.s.r, col);
    if (!value) continue;
    headers.push(value);
    headerCols.push(col);
  }
  if (!headers.length) throw new Error("The uploaded file has no header row.");

  const rows: SheetRow[] = [];
  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    const parsed: SheetRow = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      const value = readCell(row, headerCols[index] ?? -1);
      parsed[header] = value;
      if (value) hasValue = true;
    });
    if (hasValue) rows.push(parsed);
  }

  return { headers, rows, awbHeader: findAwbHeader(headers) };
};

export const readAwb = (row: SheetRow, awbHeader: string | null) =>
  normaliseAwb(awbHeader ? row[awbHeader] : "");

export const readAwbRaw = (row: SheetRow, awbHeader: string | null) =>
  (awbHeader ? row[awbHeader] : "") ?? "";
