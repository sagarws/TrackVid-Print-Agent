/**
 * Packlog sort: the order the packlog table shows its rows in, the Export
 * writes them in, and the Scan & Pack page works through them in.
 *
 * Saved with the packlog (Label Sorting, the packlog list or the packlog
 * page), so every screen and the download pick it up.
 */
import type { ScanPackBatch, ScanPackOrder } from "../../types/scanAndPack.types";
import type { PacklogSortKey } from "@shared/types/scanpack";
import { PacklogService } from "../../api/packlog-service";
import { findHeader } from "./sheet";

export type SortKey = "sheet" | PacklogSortKey;

export interface SortOption {
  key: SortKey;
  label: string;
}

export const SKU_HEADERS = ["sku", "skus", "listing sku", "listing skus"];
export const CARRIER_HEADERS = [
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
  ...labelSortOptions(batch.platform),
];

/** The sorts Label Sorting offers: Distribution Code only on Flipkart. */
export const labelSortOptions = (platform: string): (SortOption & { key: PacklogSortKey })[] => [
  { key: "sku", label: "SKU" },
  { key: "carrier", label: "Carrier Name" },
  ...(platform === "flipkart" ? [{ key: "distributionCode" as const, label: "Distribution Code" }] : []),
];

export const sortLabel = (key: SortKey | null | undefined): string =>
  key === "sku" ? "SKU" : key === "carrier" ? "Carrier Name" : key === "distributionCode" ? "Distribution Code" : "Sheet order";

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

// Before the sort was saved with the packlog, the packlog page kept it in this browser.
const legacyKey = (batchId: string) => `scanpack:sort:${batchId}`;

/** The sort a packlog is shown in: its saved one, else sheet order. */
export const readSort = (batch: Pick<ScanPackBatch, "id" | "platform" | "sortKey">): SortKey => {
  const valid = (key: unknown): key is SortKey => sortOptions(batch).some((o) => o.key === key);
  if (batch.sortKey && valid(batch.sortKey)) return batch.sortKey;
  try {
    const legacy = localStorage.getItem(legacyKey(batch.id));
    if (!batch.sortKey && valid(legacy)) return legacy;
  } catch {
    // No browser storage; the saved sort is all there is.
  }
  return "sheet";
};

/** Save a packlog's sort with it. */
export const saveSort = async (batchId: string, key: SortKey) => {
  await PacklogService.setSortKey(batchId, key === "sheet" ? null : key);
  try {
    localStorage.removeItem(legacyKey(batchId));
  } catch {
    // Nothing to clear.
  }
};
