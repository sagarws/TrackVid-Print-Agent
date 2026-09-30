/**
 * Batch assembly — turning a parsed sheet plus one or more scanned PDFs into
 * `ScanPackOrder` rows, and re-running that match when the operator bulk-uploads
 * a follow-up set of labels.
 */
import type {
  ParsedSheet,
} from "./sheet";
import type {
  ScanPackOrder,
  ScanReport,
  SheetRow,
} from "../../types/scanAndPack.types";
import { readAwb, readAwbRaw } from "./sheet";
import { awbAliases } from "./platforms";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * `SP-YYYYMMDD-HHMMSS-XXX`. Time-ordered so the batch list reads chronologically
 * even before it is sorted, with a random tail so two uploads in the same second
 * cannot collide.
 */
export const generateBatchId = (now = new Date()) => {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `SP-${stamp}-${suffix}`;
};

export const buildOrders = (sheet: ParsedSheet, batchId: string): ScanPackOrder[] =>
  sheet.rows.map((row: SheetRow, index) => ({
    id: `${batchId}:${index}`,
    rowIndex: index,
    raw: row,
    awb: readAwb(row, sheet.awbHeader),
    awbRaw: readAwbRaw(row, sheet.awbHeader),
    mapping: null,
    // A freshly parsed sheet has never been to a printer.
    packStatus: "ready",
    packedAt: null,
  }));

export interface MatchResult {
  orders: ScanPackOrder[];
  /** Rows mapped by *this* pass (does not count rows already mapped before). */
  newlyMapped: number;
  /** Rows still without a label after this pass. */
  stillUnmapped: number;
  /** AWBs found in the PDFs that no sheet row claims. */
  unmatchedAwbs: string[];
}

/** Fill in mappings from freshly scanned PDFs. */
export const applyScanReports = (
  orders: ScanPackOrder[],
  reports: ScanReport[]
): MatchResult => {
  type Hit = { docId: string; labelPages: number[]; invoicePages: number[] };

  const exact = new Map<string, Hit>();
  const alias = new Map<string, Hit>();

  reports.forEach((report) => {
    report.labels.forEach((label) => {
      // First occurrence wins: a duplicated AWB inside one upload is reported
      // separately rather than silently overwriting the earlier mapping.
      if (!exact.has(label.awb)) {
        exact.set(label.awb, {
          docId: report.docId,
          labelPages: label.labelPages,
          invoicePages: label.invoicePages,
        });
      }
    });
  });

  // Alias keys are built only after every exact key exists, so a label's real
  // AWB always takes precedence over another label's prefix-stripped form.
  exact.forEach((hit, awb) => {
    awbAliases(awb).forEach((key) => {
      if (!exact.has(key) && !alias.has(key)) alias.set(key, hit);
    });
  });

  const claimed = new Set<string>();
  let newlyMapped = 0;

  /**
   * Rows that already carry a mapping are left untouched — a bulk update tops
   * up the gaps, it never re-points an order the operator may already have
   * packed.
   */
  const exactPass = orders.map((order) => {
    if (order.mapping) {
      claimed.add(order.awb);
      return order;
    }
    const hit = order.awb ? exact.get(order.awb) : undefined;
    if (!hit) return order;

    claimed.add(order.awb);
    newlyMapped += 1;
    return { ...order, mapping: { ...hit } };
  });

  // Second pass: only the rows the exact pass could not place.
  const next = exactPass.map((order) => {
    if (order.mapping || !order.awb) return order;

    for (const key of awbAliases(order.awb)) {
      const hit = exact.get(key) ?? alias.get(key);
      if (hit) {
        claimed.add(key);
        newlyMapped += 1;
        return { ...order, mapping: { ...hit } };
      }
    }
    return order;
  });

  const unmatchedAwbs = [...exact.keys()].filter((awb) => !claimed.has(awb));

  return {
    orders: next,
    newlyMapped,
    stillUnmapped: next.filter((order) => !order.mapping).length,
    unmatchedAwbs,
  };
};

export const countMapped = (orders: ScanPackOrder[]) =>
  orders.reduce((total, order) => (order.mapping ? total + 1 : total), 0);
