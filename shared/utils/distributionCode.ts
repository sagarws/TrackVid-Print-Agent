/**
 * Flipkart's distribution code: the short sort code (`B1`, `C1`, `B5` …)
 * printed large in a box beside the bottom barcode of every label.
 *
 * It is ordinary text on the label, but a token like `B5` can also turn up in
 * an address ("Flat B5"). The code is told apart by its size: it is the
 * largest text on the label that has that shape, well above the body text.
 * When the page gives no sizes, the text order is used instead: the code sits
 * right after the `FM…` tracking id or right before "Not for resale".
 */

export interface PageTextItem {
  str: string
  /** Font height in PDF units; 0 when unknown. */
  height: number
}

const CODE = /^[A-Z]{1,2}\d{1,3}$/

const median = (values: number[]): number => {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0
}

export const distributionCodeFromItems = (items: PageTextItem[]): string | null => {
  const sized = items.filter(i => i.str.trim() && i.height > 0)
  const body = median(sized.map(i => i.height))
  let best: PageTextItem | null = null
  for (const item of sized) {
    if (!CODE.test(item.str.trim())) continue
    // Clearly bigger than the body text, and the biggest such token wins.
    if (item.height < body * 1.3) continue
    if (!best || item.height > best.height) best = item
  }
  return best ? best.str.trim() : null
}

export const distributionCodeFromText = (text: string): string | null => {
  const afterId = /\bFM[A-Z]{2,4}\d{6,16}\s+([A-Z]{1,2}\d{1,3})\b/.exec(text)
  if (afterId?.[1]) return afterId[1]
  const beforeNote = /\b([A-Z]{1,2}\d{1,3})\s+Not\s+for\s+resale/i.exec(text)
  return beforeNote?.[1] ? beforeNote[1].toUpperCase() : null
}

export const flipkartDistributionCode = (items: PageTextItem[], text: string): string | null =>
  distributionCodeFromItems(items) ?? distributionCodeFromText(text)
