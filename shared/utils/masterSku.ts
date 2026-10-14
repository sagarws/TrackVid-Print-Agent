/**
 * Master SKU — one product as the warehouse knows it, sold under many listing
 * SKUs across marketplaces. The SKU Mapping sheet lists one master SKU per
 * column: the column's first cell is the master, every cell under it is a
 * listing SKU that ships as that master.
 *
 * Shared by the main process (tagging a packlog's orders when it is created)
 * and the window (reading the mapping sheet, picking the SKU column).
 */

/** Order-sheet columns that carry the listing SKU, in priority order. */
export const SKU_HEADER_NAMES = ['sku', 'skus', 'listing sku', 'listing skus']

const canonicalHeader = (h: string) => h.toLowerCase().replace(/[\s_]+/g, ' ').trim()

/** The order sheet's SKU column, or null when it has none. */
export const findSkuHeader = (headers: string[]): string | null => {
  for (const name of SKU_HEADER_NAMES) {
    const hit = headers.find(h => canonicalHeader(h) === name)
    if (hit) return hit
  }
  return null
}

/** Lookup key for a SKU: case and surrounding whitespace never matter. */
export const skuKey = (sku: string): string => sku.trim().replace(/\s+/g, ' ').toUpperCase()

/** A column of the mapping sheet: master SKU, then its listing SKUs. */
export interface MasterSkuPair {
  listingSku: string
  masterSku: string
}

export interface MasterSkuParseResult {
  pairs: MasterSkuPair[]
  masters: number
  /** Listing SKUs found under two different masters — the first column wins. */
  conflicts: { listingSku: string; kept: string; dropped: string }[]
}

/**
 * Columns of cells (as text) → listing/master pairs. Empty cells are skipped,
 * a listing SKU repeated under the same master is kept once, and one listed
 * under two masters keeps the first and is reported.
 */
export const pairsFromColumns = (columns: string[][]): MasterSkuParseResult => {
  const byKey = new Map<string, MasterSkuPair>()
  const conflicts: MasterSkuParseResult['conflicts'] = []
  const masters = new Set<string>()
  for (const column of columns) {
    const masterSku = (column[0] ?? '').trim()
    if (!masterSku) continue
    masters.add(skuKey(masterSku))
    for (const cell of column.slice(1)) {
      const listingSku = cell.trim()
      if (!listingSku) continue
      const key = skuKey(listingSku)
      const existing = byKey.get(key)
      if (!existing) byKey.set(key, { listingSku, masterSku })
      else if (skuKey(existing.masterSku) !== skuKey(masterSku)) {
        conflicts.push({ listingSku, kept: existing.masterSku, dropped: masterSku })
      }
    }
  }
  return { pairs: [...byKey.values()], masters: masters.size, conflicts }
}

/**
 * The master SKU for an order's SKU cell. A cell can hold several SKUs
 * ("A, B" for a combo order); each is looked up and the distinct masters are
 * joined. A SKU that is itself a master SKU maps to itself. Null when nothing
 * matches.
 */
export const resolveMasterSku = (
  cell: string | undefined,
  byListing: ReadonlyMap<string, string>,
  masters: ReadonlySet<string>
): string | null => {
  const text = (cell ?? '').trim()
  if (!text) return null
  const one = (sku: string) => {
    const key = skuKey(sku)
    return byListing.get(key) ?? (masters.has(key) ? sku.trim() : null)
  }
  const whole = one(text)
  if (whole) return whole
  const found = [
    ...new Set(
      text
        .split(/[,;|]/)
        .map(part => part.trim())
        .filter(Boolean)
        .map(one)
        .filter((m): m is string => Boolean(m))
    )
  ]
  return found.length ? found.join(', ') : null
}
