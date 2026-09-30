import { describe, expect, it } from 'vitest'
import { clampWeeks, isWeekExpired, partFileName, retentionCutoffKey, weekRangeFor } from '@shared/utils/weekFolder'

describe('weekRangeFor', () => {
  it('runs Monday to Sunday in IST', () => {
    // Wed 30 Sep 2026, 10:00 IST
    expect(weekRangeFor(new Date('2026-09-30T04:30:00Z'))).toEqual({
      weekStart: '2026-09-28',
      weekEnd: '2026-10-04',
      folderName: '2026-09-28_to_2026-10-04'
    })
  })

  it('puts Sunday 23:30 IST in the week that is ending, not the next one', () => {
    // Sun 4 Oct 2026, 23:30 IST = 18:00 UTC
    expect(weekRangeFor(new Date('2026-10-04T18:00:00Z')).weekStart).toBe('2026-09-28')
  })

  it('puts Monday 00:30 IST in the new week, even though it is still Sunday in UTC', () => {
    // Mon 5 Oct 2026, 00:30 IST = Sun 19:00 UTC
    expect(weekRangeFor(new Date('2026-10-04T19:00:00Z')).weekStart).toBe('2026-10-05')
  })
})

describe('retention', () => {
  const now = new Date('2026-09-30T04:30:00Z') // week of 2026-09-28

  it('keeps this week and last week by default, like the backend', () => {
    expect(retentionCutoffKey(now, 2)).toBe('2026-09-21')
    expect(isWeekExpired('2026-10-04', now, 2)).toBe(false) // this week
    expect(isWeekExpired('2026-09-27', now, 2)).toBe(false) // last week
    expect(isWeekExpired('2026-09-20', now, 2)).toBe(true) // the week before last
  })

  it('keeps only this week when set to 1', () => {
    expect(isWeekExpired('2026-10-04', now, 1)).toBe(false)
    expect(isWeekExpired('2026-09-27', now, 1)).toBe(true)
  })

  it('keeps four weeks when set to 4', () => {
    expect(isWeekExpired('2026-09-13', now, 4)).toBe(false)
    expect(isWeekExpired('2026-09-06', now, 4)).toBe(true)
  })

  it('clamps nonsense settings', () => {
    expect(clampWeeks(0)).toBe(1)
    expect(clampWeeks(500)).toBe(52)
    expect(clampWeeks(Number.NaN)).toBe(2)
  })
})

describe('partFileName', () => {
  it('matches the backend name and strips path characters', () => {
    expect(partFileName('SP-20260930-101500-ABC', 'label', 'FMPC6419156619')).toBe(
      'SP-20260930-101500-ABC-label-FMPC6419156619.pdf'
    )
    expect(partFileName('SP-1', 'invoice', '../x')).toBe('SP-1-invoice-.._x.pdf')
  })
})
