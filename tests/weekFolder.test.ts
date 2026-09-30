import { describe, expect, it } from 'vitest'
import { clampWeeks, isWeekExpired, partFileName, retentionCutoffKey, roundRobin, weekRangeFor } from '@shared/utils/weekFolder'

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

describe('roundRobin', () => {
  it('deals records like the Settings example: 15 records over 3 workers', () => {
    const records = Array.from({ length: 15 }, (_, i) => i + 1)
    expect(roundRobin(records, 3)).toEqual([
      [1, 4, 7, 10, 13],
      [2, 5, 8, 11, 14],
      [3, 6, 9, 12, 15]
    ])
  })

  it('never makes empty workers', () => {
    expect(roundRobin([1, 2], 3)).toEqual([[1], [2]])
    expect(roundRobin([], 3)).toEqual([[]])
  })
})

describe('day-wise folders', () => {
  it('names the IST day and the packlog', async () => {
    const { packlogFolderParts, istDateKey } = await import('@shared/utils/weekFolder')
    // 30 Sep 2026, 23:50 IST = 18:20 UTC — still the 30th in India.
    expect(istDateKey(new Date('2026-09-30T18:20:00Z'))).toBe('2026-09-30')
    // 1 Oct 2026, 00:10 IST = 30 Sep 18:40 UTC — already the 1st in India.
    expect(istDateKey(new Date('2026-09-30T18:40:00Z'))).toBe('2026-10-01')
    expect(packlogFolderParts(new Date('2026-09-30T14:31:25Z'), 'SP-20260930-200115-GIO')).toEqual([
      '2026-09-30',
      'SP-20260930-200115-GIO'
    ])
  })

  it('expires a day folder with its week', async () => {
    const { isDayExpired, DAY_FOLDER_PATTERN, PACKLOG_FOLDER_PATTERN } = await import('@shared/utils/weekFolder')
    const now = new Date('2026-09-30T04:30:00Z') // Wednesday, week of 28 Sep
    expect(isDayExpired('2026-09-28', now, 2)).toBe(false) // this week (Monday)
    expect(isDayExpired('2026-09-21', now, 2)).toBe(false) // last week
    expect(isDayExpired('2026-09-20', now, 2)).toBe(true) // Sunday of the week before last
    expect(isDayExpired('2026-09-27', now, 1)).toBe(true) // last week, keeping one
    expect(DAY_FOLDER_PATTERN.test('2026-09-30')).toBe(true)
    expect(DAY_FOLDER_PATTERN.test('2026-09-28_to_2026-10-04')).toBe(false)
    expect(PACKLOG_FOLDER_PATTERN.test('SP-20260930-200115-GIO')).toBe(true)
    expect(PACKLOG_FOLDER_PATTERN.test('my photos')).toBe(false)
  })
})
