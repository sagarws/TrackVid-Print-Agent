import { describe, expect, it } from 'vitest'
import { userDisplayName } from '@shared/utils/userName'

describe('userDisplayName', () => {
  const base = { id: '1', email: 'pack@example.com' }

  it('uses fullName from the backend name object', () => {
    expect(userDisplayName({ ...base, name: { firstName: 'Himanshu', lastName: 'Vasani', fullName: 'Himanshu Vasani' } })).toBe(
      'Himanshu Vasani'
    )
  })

  it('joins first and last name when fullName is missing', () => {
    expect(userDisplayName({ ...base, name: { firstName: 'Himanshu', lastName: 'Vasani' } })).toBe('Himanshu Vasani')
    expect(userDisplayName({ ...base, name: { firstName: 'Himanshu' } })).toBe('Himanshu')
  })

  it('accepts a plain string name', () => {
    expect(userDisplayName({ ...base, name: 'Packer One' })).toBe('Packer One')
  })

  it('falls back to the email, then a generic label', () => {
    expect(userDisplayName({ ...base, name: {} })).toBe('pack@example.com')
    expect(userDisplayName({ ...base, name: null })).toBe('pack@example.com')
    expect(userDisplayName(null)).toBe('TrackVid user')
  })
})
