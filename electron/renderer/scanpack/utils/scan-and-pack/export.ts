/**
 * Packlog status filters and the .xlsx export built on them. The packlog page
 * tabs and the export share `matchesStatus`, so each exported sheet holds
 * exactly the rows its tab shows.
 */
import * as XLSX from "xlsx";
import type { ScanPackBatch } from "../../types/scanAndPack.types";

export type StatusFilter = "all" | "mapped" | "unmapped" | "ready" | "packed";

export const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "mapped", label: "Mapped" },
  { key: "unmapped", label: "Not Mapped" },
  { key: "ready", label: "Ready to pack" },
  { key: "packed", label: "Packed" },
];

export const matchesStatus = (order: ScanPackBatch["orders"][number], status: StatusFilter) => {
  if (status === "mapped") return Boolean(order.mapping);
  if (status === "unmapped") return !order.mapping;
  // Anything not literally "packed" is ready, as the Pack Status column shows it.
  if (status === "ready") return order.packStatus !== "packed";
  if (status === "packed") return order.packStatus === "packed";
  return true;
};

const EXPORT_SHEET_COLUMNS = [
  "Order Number",
  "Suborder Number",
  "Invoice Number",
  "Order Date",
  "OMS SKU",
  "SKU",
  "Listing ID",
  "Quantity",
  "Awb Number",
];

const normalizeHeader = (header: string) => header.replace(/[\s_]+/g, "").toLowerCase();

/** One sheet per status tab, each holding exactly the rows that tab shows. */
export const exportBatchXlsx = (batch: ScanPackBatch) => {
  // Uploaded sheets vary in casing and spacing ("AWB number", "Listing_ID"), so
  // each export column is resolved to whatever the sheet actually called it.
  const sourceHeaders = EXPORT_SHEET_COLUMNS.map((column) =>
    batch.headers.find((header) => normalizeHeader(header) === normalizeHeader(column))
  );
  // The sheet's own Shipping Label / Invoice columns are placeholders; the
  // export reports whether that part is actually mapped.
  const columns = [...EXPORT_SHEET_COLUMNS, "Shipping Label", "Invoice"];
  const ordered = batch.orders.slice().sort((a, b) => a.rowIndex - b.rowIndex);

  const workbook = XLSX.utils.book_new();
  for (const tab of STATUS_TABS) {
    const data = ordered
      .filter((order) => matchesStatus(order, tab.key))
      .map((order) => [
        ...sourceHeaders.map((header) => (header ? order.raw[header] ?? "" : "")),
        order.mapping?.labelPages.length ? "Yes" : "No",
        order.mapping?.invoicePages.length ? "Yes" : "No",
      ]);
    const sheet = XLSX.utils.aoa_to_sheet([columns, ...data]);
    sheet["!cols"] = columns.map((column) => ({ wch: Math.max(14, column.length + 2) }));
    XLSX.utils.book_append_sheet(workbook, sheet, tab.label);
  }
  XLSX.writeFile(workbook, `${batch.batchId}.xlsx`);
};
