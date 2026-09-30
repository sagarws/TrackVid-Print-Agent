import { describe, expect, it } from 'vitest'
import { pageList } from '@shared/utils/pageList'

describe('pageList', () => {
  it('turns 0-based indices into 1-based pages', () => {
    expect(pageList([0])).toBe('1')
    expect(pageList([4])).toBe('5')
  })

  it('collapses runs into ranges', () => {
    expect(pageList([4, 5])).toBe('5-6')
    expect(pageList([4, 5, 8])).toBe('5-6,9')
    expect(pageList([0, 1, 2, 9, 11, 12])).toBe('1-3,10,12-13')
  })

  it('ignores order, duplicates and invalid entries', () => {
    expect(pageList([8, 4, 5, 5])).toBe('5-6,9')
    expect(pageList([-1, 1.5, 2])).toBe('3')
    expect(pageList([])).toBe('')
  })
})
