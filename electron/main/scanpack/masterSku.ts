import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { MasterSkuMergeCounts, MasterSkuRecord, MasterSkuSummary } from '@shared/types/scanpack'
import { findSkuHeader, resolveMasterSku, skuKey, type MasterSkuPair } from '@shared/utils/masterSku'
import { readDurableJson, removeDurableJson, writeDurableJson } from '../durableJson'
import { logger } from '../logger'

/**
 * The `master-sku` table: which master SKU each listing SKU ships as.
 *
 *   <userData>/master-sku.json   { fileName, updatedAt, records: [{ id, listingSku, masterSku }] }
 *
 * Kept outside `<userData>/scanpack/`, where every file is read as a packlog.
 * Written durably (see durableJson.ts) so a power cut never loses it.
 */

interface Table {
  fileName: string | null
  updatedAt: string | null
  records: MasterSkuRecord[]
}

interface Index {
  /** skuKey(listing SKU) → master SKU as written in the sheet. */
  byListing: Map<string, string>
  /** skuKey of every master SKU. */
  masters: Set<string>
}

const tableFile = (): string => join(app.getPath('userData'), 'master-sku.json')

let table: Table | null = null
let index: Index | null = null

const load = (): Table => {
  if (table) return table
  table = { fileName: null, updatedAt: null, records: [] }
  const file = tableFile()
  if (existsSync(file) || existsSync(`${file}.tmp`) || existsSync(`${file}.bak`)) {
    try {
      table = readDurableJson<Table>(file, t => Array.isArray(t?.records))
    } catch (error) {
      // Left on disk, never overwritten until the next import, so it can be recovered.
      logger.error('[scanpack] could not read the master SKU table', error)
    }
  }
  return table
}

const getIndex = (): Index => {
  if (index) return index
  const { records } = load()
  index = {
    byListing: new Map(records.map(r => [skuKey(r.listingSku), r.masterSku])),
    masters: new Set(records.map(r => skuKey(r.masterSku)))
  }
  return index
}

const summarise = (t: Table): MasterSkuSummary => ({
  total: t.records.length,
  masters: new Set(t.records.map(r => skuKey(r.masterSku))).size,
  fileName: t.fileName,
  updatedAt: t.updatedAt
})

export const masterSkuSummary = (): MasterSkuSummary => summarise(load())

export const listMasterSkus = (): MasterSkuRecord[] => load().records

/**
 * Merge the pairs from a mapping sheet into the table. Nothing is ever added
 * twice: a listing SKU already stored under the same master is skipped, and
 * one stored under a different master is moved to the new one (a listing SKU
 * ships as exactly one master, so a second record for it would be ambiguous).
 * Listing SKUs the sheet does not mention are kept.
 */
export const mergeMasterSkus = (fileName: string, pairs: MasterSkuPair[]): MasterSkuMergeCounts => {
  const current = load()
  const records = current.records.map(r => ({ ...r }))
  const byKey = new Map(records.map(r => [skuKey(r.listingSku), r]))
  let added = 0
  let updated = 0
  let skipped = 0
  for (const pair of pairs) {
    const listingSku = String(pair?.listingSku ?? '').trim()
    const masterSku = String(pair?.masterSku ?? '').trim()
    if (!listingSku || !masterSku) continue
    const key = skuKey(listingSku)
    const existing = byKey.get(key)
    if (!existing) {
      const record = { id: randomBytes(12).toString('hex'), listingSku, masterSku }
      records.push(record)
      byKey.set(key, record)
      added++
    } else if (skuKey(existing.masterSku) === skuKey(masterSku)) {
      skipped++
    } else {
      existing.masterSku = masterSku
      updated++
    }
  }
  // A sheet with nothing new leaves the table, and its file, untouched.
  if (added || updated) {
    table = { fileName, updatedAt: new Date().toISOString(), records }
    writeDurableJson(tableFile(), table)
    index = null
  }
  return { ...summarise(load()), added, updated, skipped }
}

export const clearMasterSkus = (): MasterSkuSummary => {
  removeDurableJson(tableFile())
  table = { fileName: null, updatedAt: null, records: [] }
  index = null
  return summarise(table)
}

/**
 * The master SKU for one order row, read from the sheet's SKU column. Null
 * when the sheet has no SKU column or nothing in the table matches.
 */
export const masterSkuForRow = (headers: string[], row: Record<string, string>): string | null => {
  const header = findSkuHeader(headers)
  if (!header) return null
  const { byListing, masters } = getIndex()
  return resolveMasterSku(row[header], byListing, masters)
}
