/**
 * Packlog sort: the order the packlog table shows its rows in, the Export
 * writes them in, and the Scan & Pack page works through them in.
 *
 * Chosen per packlog on the packlog page and remembered in this browser, so
 * the pack page picks it up without being told.
 */
import type { ScanPackBatch, ScanPackOrder } from "../../types/scanAndPack.types";
import { findHeader } from "./sheet";

export type SortKey = "sheet" | "sku" | "carrier" | "distributionCode";

export interface SortOption {
  key: SortKey;
  label: string;
}

const SKU_HEADERS = ["sku", "skus", "listing sku", "listing skus"];
const CARRIER_HEADERS = [
  "carrier name",
  "carrier",
  "courier name",
  "courier",
  "shipping provider",
  "logistics partner",
  "delivery partner",
];

/** Sheet order always; Distribution Code only on Flipkart packlogs. */
export const sortOptions = (batch: Pick<ScanPackBatch, "platform">): SortOption[] => [
  { key: "sheet", label: "Sheet order" },
  { key: "sku", label: "SKU" },
  { key: "carrier", label: "Carrier Name" },
  ...(batch.platform === "flipkart" ? [{ key: "distributionCode" as const, label: "Distribution Code" }] : []),
];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Comparator for a sort key: by that value (B2 before B10, blanks last), then
 * in sheet order so equal values keep the order the shelves are walked in.
 */
export const orderComparator = (
  batch: Pick<ScanPackBatch, "headers" | "platform">,
  key: SortKey
): ((a: ScanPackOrder, b: ScanPackOrder) => number) => {
  const header =
    key === "sku" ? findHeader(batch.headers, SKU_HEADERS) : key === "carrier" ? findHeader(batch.headers, CARRIER_HEADERS) : null;
  const value = (order: ScanPackOrder): string => {
    if (key === "distributionCode") return batch.platform === "flipkart" ? order.distributionCode ?? "" : "";
    return header ? (order.raw[header] ?? "").trim() : "";
  };
  return (a, b) => {
    if (key !== "sheet") {
      const av = value(a);
      const bv = value(b);
      if (av !== bv) {
        if (!av) return 1;
        if (!bv) return -1;
        const cmp = collator.compare(av, bv);
        if (cmp) return cmp;
      }
    }
    return a.rowIndex - b.rowIndex;
  };
};

/** The column a sort key reads, for telling the operator when the sheet has none. */
export const sortHeaderMissing = (batch: Pick<ScanPackBatch, "headers">, key: SortKey): boolean =>
  (key === "sku" && !findHeader(batch.headers, SKU_HEADERS)) ||
  (key === "carrier" && !findHeader(batch.headers, CARRIER_HEADERS));

const storageKey = (batchId: string) => `scanpack:sort:${batchId}`;

export const readSort = (batch: Pick<ScanPackBatch, "id" | "platform">): SortKey => {
  try {
    const stored = localStorage.getItem(storageKey(batch.id));
    const option = sortOptions(batch).find((o) => o.key === stored);
    return option ? option.key : "sheet";
  } catch {
    return "sheet";
  }
};

export const writeSort = (batchId: string, key: SortKey) => {
  try {
    if (key === "sheet") localStorage.removeItem(storageKey(batchId));
    else localStorage.setItem(storageKey(batchId), key);
  } catch {
    // Not remembered; the sort still applies on this page.
  }
};
