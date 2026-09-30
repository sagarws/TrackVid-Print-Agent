/**
 * The subset of TrackVid-FE src/config/constant.ts the ported Scan & Pack
 * screens read. Same keys and values, so a bench's printer assignment means
 * the same thing here as in the web app.
 */
export const LOCALSTORAGE_SCANPACK_LABEL_PRINTER = "scanpack:printer:label";
export const LOCALSTORAGE_SCANPACK_INVOICE_PRINTER = "scanpack:printer:invoice";
// When "1", the packer auto-copies the selected order's AWB to the clipboard
// on any Print action and toasts a confirmation.
export const LOCALSTORAGE_SCANPACK_COPY_AWB_ON_PRINT = "scanpack:copyAwbOnPrint";
// Sticky Print/Download target ("label" | "invoice" | "both").
export const LOCALSTORAGE_SCANPACK_PRINT_TARGET = "scanpack:printTarget";
// Display names for a packlog's scan mode and the Printer Setup print target.
export const SCANPACK_PART_LABELS: Record<"label" | "invoice" | "both", string> = {
  label: "Label",
  invoice: "Invoice",
  both: "Both",
};
