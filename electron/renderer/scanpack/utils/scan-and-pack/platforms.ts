/**
 * Per-platform rules for reading a shipping-label PDF.
 *
 * Every marketplace prints a different label, so page classification and AWB
 * extraction are configured here rather than hard-coded in the scanner. Amazon
 * prints a rasterised label, so its AWB is only recoverable from the barcode;
 * AJIO, Myntra and Flipkart print typographic labels whose AWB appears in the
 * text layer as well as in the barcode.
 */

export interface PlatformConfig {
  key: string;
  label: string;
  enabled: boolean;
  /**
   * True when the page is a shipping label (as opposed to an invoice or an
   * invoice continuation page). Runs on the page's extracted text, which is
   * cheap — pages rejected here never get rasterised for barcode decoding.
   *
   * Invoice pages must be rejected even when they carry the AWB in their text
   * (AJIO's does), so the scanner treats the pages between one label and the
   * next as that label's invoice — one label / next page(s) is invoice.
   */
  isLabelPage: (text: string) => boolean;
  /** Pull the AWB straight out of the text layer, when the label has one. */
  awbFromText: (text: string) => string | null;
  /** Accept/reject a decoded barcode payload as an AWB. */
  awbFromBarcode: (value: string) => string | null;
  /** ZXing formats worth trying on a rasterised label page. */
  barcodeFormats: string[];
  /**
   * Last-resort AWB recovery from the tax-invoice page that follows a label.
   * Only consulted when the label page itself is undecodable (e.g. cropped so
   * the barcode is cut off) — the scanner walks forward through the following
   * non-label pages until this hook returns a value, then pins that AWB back
   * on the preceding label.
   */
  awbFromInvoiceText?: (text: string) => string | null;
  /**
   * When true, the scanner flips to invoice-anchored mode: it walks *invoice*
   * pages instead of label pages, groups consecutive invoices, extracts the
   * AWB from the invoice text, and treats the page immediately before each
   * invoice group as its label. Bypasses barcode decoding entirely.
   *
   * Use for platforms whose label page is fragile (barcode cropped, template
   * cut, classification markers missing) while the invoice text is always
   * intact — AJIO is the canonical example. Requires `isInvoicePage` and
   * `awbFromInvoiceText`.
   */
  useInvoiceAsAnchor?: boolean;
  /** Companion to `useInvoiceAsAnchor` — decides which pages are invoices. */
  isInvoicePage?: (text: string) => boolean;
}

/** Text markers that identify a tax-invoice page — never treated as a label. */
const INVOICE_MARKERS = /tax\s*invoice|bill of supply|cash memo|authorized signatory|hsn|original for recipient/i;

const AMAZON: PlatformConfig = {
  key: "amazon",
  label: "Amazon",
  enabled: true,
  // Amazon label pages are a single rasterised image with almost no text layer
  // (just the seller SKU). Invoice pages are text-heavy and always carry the
  // "Tax Invoice / Bill of Supply" header.
  isLabelPage: (text) => !INVOICE_MARKERS.test(text) && text.trim().length < 400,
  awbFromText: (text) => {
    const m = /\bAWB\s*(?:NO\.?|NUMBER)?\s*[:#-]?\s*([A-Z0-9]{8,22})\b/i.exec(text);
    return m?.[1] ? m[1].toUpperCase() : null;
  },
  // The Code128 above "AWB <n>" encodes exactly the AWB digits. The four
  // DataMatrix squares hold an internal Amazon token, so anything non-numeric
  // (or too short) is discarded.
  awbFromBarcode: (value) => (/^[0-9]{10,20}$/.test(value.trim()) ? value.trim() : null),
  barcodeFormats: ["Code128"],
  // Tax invoice pages carry "AWB Number: <n>" — enables invoice-only mode.
  isInvoicePage: (text) => INVOICE_MARKERS.test(text),
  awbFromInvoiceText: (text) => {
    const m = /\bAWB\s*(?:NO\.?|NUMBER)\s*[:#-]?\s*([A-Z0-9]{8,22})\b/i.exec(text);
    return m?.[1] ? m[1].toUpperCase() : null;
  },
};

/**
 * AJIO scanning is invoice-anchored: the tax-invoice page is the reliable one,
 * so the scanner reads the AWB from the invoice text ("AWB NUMBER: <value>")
 * and pairs it with the page immediately above as its label.
 *
 * Label-anchored decoding was tried first and did not survive the field:
 *  - The AWB never lands in the label's text layer intact (pdf.js emits each
 *    glyph as its own text run, so `14187462076917` becomes `1 4 1 …`).
 *  - Barcode decoding fails whenever the label is cropped so the AWB bars are
 *    cut off, and further mis-pairs the invoice with the previous label.
 *  - Label classification (`isLabelPage`) itself can miss cropped labels whose
 *    keywords were sliced off.
 * The invoice text, in contrast, is always intact and always names the AWB
 * explicitly, and the previous page IS the label — no interpretation required.
 * Both AJIO AWB shapes drop out of the same regex:
 *   - Xpressbees et al.: 12-15 digits (e.g. 14187462076917).
 *   - Shadowfax: `SF<digits>AJI`     (e.g. SF3725845897AJI).
 */
const AJIO: PlatformConfig = {
  key: "ajio",
  label: "AJIO",
  enabled: true,
  // Default (`both`) uses invoice-anchored — see notes above.
  useInvoiceAsAnchor: true,
  isInvoicePage: (text) => INVOICE_MARKERS.test(text),
  awbFromInvoiceText: (text) => {
    const m = /\bAWB\s*(?:NO\.?|NUMBER)\s*[:#-]?\s*([A-Z0-9]{8,20})\b/i.exec(text);
    return m?.[1] ? m[1].toUpperCase() : null;
  },
  // Label-anchored fallback for when the operator picks "Label only" mode.
  // The AWB is never in the label's text layer (pdf.js emits digits as
  // separate runs), so text extraction is skipped and the Code128 barcode is
  // the source. Two carrier shapes coexist on AJIO PDFs; both are accepted
  // and the FN/S decoys are rejected by the length + prefix rules.
  isLabelPage: (text) =>
    !INVOICE_MARKERS.test(text) &&
    /ajio|routing\s*code|address\s*type|payment\s*type|carrier\s*name|ship\s*to/i.test(text),
  awbFromText: () => null,
  awbFromBarcode: (value) => {
    const v = value.trim().toUpperCase();
    if (/^[0-9]{12,15}$/.test(v)) return v;         // Xpressbees et al.
    if (/^SF[0-9]{8,15}AJI$/.test(v)) return v;     // Shadowfax
    return null;
  },
  barcodeFormats: ["Code128"],
};

/**
 * Myntra ships via Delhivery. The label prints an alphanumeric AWB like
 * `MYSP1454953404` in the text layer and encodes the same value in a Code128
 * barcode. Some Delhivery labels encode the digits alone, so both shapes are
 * accepted from the barcode.
 */
const MYNTRA: PlatformConfig = {
  key: "myntra",
  label: "Myntra",
  enabled: true,
  isLabelPage: (text) =>
    !INVOICE_MARKERS.test(text) &&
    /delhivery|buyer'?s\s*name|if\s*undelivered|MYSP\d+|NORMAL\s*-\s*Fwd/i.test(text),
  awbFromText: (text) => {
    const m = /\b(MYSP\d{6,20})\b/i.exec(text);
    return m?.[1] ? m[1].toUpperCase() : null;
  },
  awbFromBarcode: (value) => {
    const v = value.trim().toUpperCase();
    if (/^MYSP[0-9]{6,20}$/.test(v)) return v;
    if (/^[0-9]{10,20}$/.test(v)) return v;
    return null;
  },
  barcodeFormats: ["Code128"],
  isInvoicePage: (text) => INVOICE_MARKERS.test(text),
  awbFromInvoiceText: (text) => {
    const m = /\bAWB\s*(?:NO\.?|NUMBER)\s*[:#-]?\s*([A-Z0-9]{8,22})\b/i.exec(text);
    return m?.[1] ? m[1].toUpperCase() : null;
  },
};

/**
 * Flipkart labels are typographic and ship with no invoice in the same PDF.
 * The AWB appears as "AWB No. <value>" in the text layer and as a Code128
 * barcode. Two shapes are used on the same PDF:
 *   - pure numeric, 10-15 digits          (e.g. 1344861868343)
 *   - `FM<letters+digits>` alphanumeric   (e.g. FMPC6419156619, FMPP4226974998)
 * The order # is a 20-char `OD…` string on every page and must not be picked
 * up — the barcode filter's length/prefix rules keep it out.
 *
 * Every page in a Flipkart PDF is a label (no invoice pages exist), so any page
 * whose AWB is not decoded would otherwise get absorbed as an "invoice page"
 * for the previous label and the whole PDF would come out when that order is
 * printed. The regexes below cover both AWB shapes so every label decodes.
 */
const FLIPKART: PlatformConfig = {
  key: "flipkart",
  label: "Flipkart",
  enabled: true,
  isLabelPage: (text) =>
    !INVOICE_MARKERS.test(text) && /flipkart|e-?kart|AWB\s*No\.?/i.test(text),
  awbFromText: (text) => {
    const m = /\bAWB\s*No\.?\s*[:#-]?\s*([A-Z0-9]{10,20})\b/i.exec(text);
    return m?.[1] ? m[1].toUpperCase() : null;
  },
  awbFromBarcode: (value) => {
    const v = value.trim().toUpperCase();
    if (/^[0-9]{10,15}$/.test(v)) return v;
    if (/^FM[A-Z0-9]{8,18}$/.test(v)) return v;
    return null;
  },
  barcodeFormats: ["Code128"],
};

export const PLATFORMS: PlatformConfig[] = [AMAZON, FLIPKART, MYNTRA, AJIO];

export const getPlatform = (key: string): PlatformConfig | undefined =>
  PLATFORMS.find((p) => p.key === key);

/**
 * Canonical form used for every AWB comparison — applied to the sheet value,
 * the decoded barcode and anything typed into the Scan & Pack box, so matching
 * is fully case-insensitive and ignores the separators operators paste in
 * ("awb 1685-4397-8795" and "AWB168543978795" collapse to the same key).
 */
export const normaliseAwb = (value: unknown): string =>
  String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/**
 * Secondary keys an AWB may also be matched under.
 *
 * Labels print the number as "AWB 168543978795", so operators routinely paste
 * the prefix into the sheet while the barcode encodes the digits alone. The
 * alias is only ever consulted after every exact match has been made, so a real
 * AWB can never be shadowed by another row's stripped prefix.
 */
export const awbAliases = (normalised: string): string[] => {
  const withoutPrefix = /^AWB([0-9]{8,})$/.exec(normalised)?.[1];
  return withoutPrefix ? [withoutPrefix] : [];
};
