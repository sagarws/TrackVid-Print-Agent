/**
 * Label bundles: a packlog's labels split into one PDF per SKU, master SKU,
 * carrier or distribution code, for the ZIP download. Distribution codes are
 * further cut into chunks of a chosen size, each code in its own folder.
 */
import type { ScanPackBatch, ScanPackOrder } from "../../types/scanAndPack.types";
import { CARRIER_HEADERS, SKU_HEADERS } from "./sort";
import { findHeader } from "./sheet";

export type BundleBy = "sku" | "masterSku" | "carrier" | "distributionCode";

export const BUNDLE_LABELS: Record<BundleBy, string> = {
  sku: "Listing SKU",
  masterSku: "Master SKU",
  carrier: "Carrier Name",
  distributionCode: "Distribution Code",
};

const BLANK: Record<BundleBy, string> = {
  sku: "No SKU",
  masterSku: "No Master SKU",
  carrier: "No Carrier",
  distributionCode: "No Distribution Code",
};

export const DEFAULT_GROUP_SIZE = 100;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** A name Windows, macOS and ZIP tools all accept as a file or folder. */
const safeName = (text: string) =>
  text
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 80) || "_";

export interface BundleGroup {
  /** Path inside the ZIP, e.g. "SKU-123.pdf" or "B1/B1_1-100.pdf". */
  name: string;
  orderIds: string[];
}

/**
 * The bundles for `orders` (already filtered to those with the part mapped):
 * one per value, values in natural order (B2 before B10) with blanks last,
 * orders in sheet order inside each.
 */
export const buildBundleGroups = (
  batch: Pick<ScanPackBatch, "headers">,
  orders: ScanPackOrder[],
  by: BundleBy,
  groupSize = DEFAULT_GROUP_SIZE
): BundleGroup[] => {
  const header =
    by === "sku" ? findHeader(batch.headers, SKU_HEADERS) : by === "carrier" ? findHeader(batch.headers, CARRIER_HEADERS) : null;
  const value = (order: ScanPackOrder): string => {
    if (by === "masterSku") return (order.masterSku ?? "").trim();
    if (by === "distributionCode") return (order.distributionCode ?? "").trim();
    return header ? (order.raw[header] ?? "").trim() : "";
  };

  // Group case-insensitively under the first spelling seen.
  const groups = new Map<string, { label: string; orders: ScanPackOrder[] }>();
  for (const order of orders) {
    const raw = value(order);
    const key = raw.toLowerCase();
    const group = groups.get(key) ?? { label: raw, orders: [] };
    group.orders.push(order);
    groups.set(key, group);
  }

  const sorted = [...groups.values()].sort((a, b) => {
    if (!a.label) return 1;
    if (!b.label) return -1;
    return collator.compare(a.label, b.label);
  });

  const used = new Set<string>();
  const unique = (base: string) => {
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    used.add(name.toLowerCase());
    return name;
  };

  const result: BundleGroup[] = [];
  for (const group of sorted) {
    const ids = group.orders.sort((a, b) => a.rowIndex - b.rowIndex).map((o) => o.id);
    const base = unique(safeName(group.label || BLANK[by]));
    if (by !== "distributionCode") {
      result.push({ name: `${base}.pdf`, orderIds: ids });
      continue;
    }
    const size = Math.max(1, Math.floor(groupSize) || DEFAULT_GROUP_SIZE);
    for (let start = 0; start < ids.length; start += size) {
      const chunk = ids.slice(start, start + size);
      result.push({ name: `${base}/${base}_${start + 1}-${start + chunk.length}.pdf`, orderIds: chunk });
    }
  }
  return result;
};
