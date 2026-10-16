import { describe, expect, it } from 'vitest'
import { distributionCodeFromItems, distributionCodeFromText, flipkartDistributionCode } from '@shared/utils/distributionCode'

const body = (str: string) => ({ str, height: 8 })

describe('distributionCodeFromItems', () => {
  it('picks the large code box, not a same-shaped token in the address', () => {
    const items = [
      body('Shipping/Customer address:'),
      body('Flat B4, L 133 lajpat society'),
      body('B4'),
      body('SNG-1070-Mustard-S'),
      body('FMPP4227953307'),
      { str: 'HBD: 20 - 08', height: 11 },
      { str: 'B5', height: 18 },
      body('Not for resale.')
    ]
    expect(distributionCodeFromItems(items)).toBe('B5')
  })

  it('returns null when no code stands out', () => {
    expect(distributionCodeFromItems([body('B4'), body('Name: Shivam'), body('FMPP4227953307')])).toBeNull()
  })
})

describe('distributionCodeFromText', () => {
  it('reads the code after the FM id or before "Not for resale"', () => {
    expect(distributionCodeFromText('QTY 1 FMPP4227953307 B5 Not for resale.')).toBe('B5')
    expect(distributionCodeFromText('FMPP4227953307 Printed C1 Not for resale.')).toBe('C1')
    expect(distributionCodeFromText('FMPP4227953307 Not for resale.')).toBeNull()
  })

  it('falls back to the text when the page has no sizes', () => {
    expect(flipkartDistributionCode([{ str: 'B1', height: 0 }], 'FMPC6419156619 B1 Not for resale')).toBe('B1')
  })
})
