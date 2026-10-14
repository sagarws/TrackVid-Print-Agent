import { describe, expect, it } from 'vitest'
import { findSkuHeader, pairsFromColumns, resolveMasterSku, skuKey } from '@shared/utils/masterSku'

describe('pairsFromColumns', () => {
  it('reads the first cell as the master and the rest as its listing SKUs', () => {
    const result = pairsFromColumns([
      ['AIRPODS_WHITE', 'MAP_AIRPOD-WHT-A89', 'MAP_AIRPOD-WHT-A39', ''],
      ['CMF_BLK', 'MAP_AIRPOD-WHT-A22', '', '']
    ])
    expect(result.masters).toBe(2)
    expect(result.pairs).toEqual([
      { listingSku: 'MAP_AIRPOD-WHT-A89', masterSku: 'AIRPODS_WHITE' },
      { listingSku: 'MAP_AIRPOD-WHT-A39', masterSku: 'AIRPODS_WHITE' },
      { listingSku: 'MAP_AIRPOD-WHT-A22', masterSku: 'CMF_BLK' }
    ])
    expect(result.conflicts).toEqual([])
  })

  it('skips columns without a master and keeps the first master for a repeated listing SKU', () => {
    const result = pairsFromColumns([
      ['', 'ORPHAN'],
      ['A', 'x-1', 'X-1'],
      ['B', 'x-1']
    ])
    expect(result.pairs).toEqual([{ listingSku: 'x-1', masterSku: 'A' }])
    expect(result.conflicts).toEqual([{ listingSku: 'x-1', kept: 'A', dropped: 'B' }])
  })
})

describe('resolveMasterSku', () => {
  const byListing = new Map([
    [skuKey('map_airpod-wht-a89'), 'AIRPODS_WHITE'],
    [skuKey('KIDSCAMERA-THS05'), 'KIDS_CAM_PINK']
  ])
  const masters = new Set([skuKey('AIRPODS_WHITE'), skuKey('KIDS_CAM_PINK')])

  it('matches regardless of case and surrounding spaces', () => {
    expect(resolveMasterSku('  MAP_AIRPOD-WHT-A89 ', byListing, masters)).toBe('AIRPODS_WHITE')
  })

  it('maps a master SKU to itself', () => {
    expect(resolveMasterSku('kids_cam_pink', byListing, masters)).toBe('kids_cam_pink')
  })

  it('joins the distinct masters of a multi-SKU cell', () => {
    expect(resolveMasterSku('MAP_AIRPOD-WHT-A89, KIDSCAMERA-THS05', byListing, masters)).toBe(
      'AIRPODS_WHITE, KIDS_CAM_PINK'
    )
  })

  it('returns null when nothing matches', () => {
    expect(resolveMasterSku('UNKNOWN', byListing, masters)).toBeNull()
    expect(resolveMasterSku('', byListing, masters)).toBeNull()
  })
})

describe('findSkuHeader', () => {
  it('prefers "SKU" and accepts "Listing SKU"', () => {
    expect(findSkuHeader(['OMS SKU', 'SKU', 'Listing SKU'])).toBe('SKU')
    expect(findSkuHeader(['OMS SKU', 'Listing_SKU'])).toBe('Listing_SKU')
    expect(findSkuHeader(['OMS SKU'])).toBeNull()
  })
})
