import { describe, expect, it } from 'vitest'
import { isOriginAllowed, normaliseOrigin } from '@shared/utils/origin'

const ALLOWED = ['https://trackvid.in', 'https://*.trackvid.in', 'http://localhost:3000']

describe('isOriginAllowed', () => {
  it('accepts an exact origin', () => {
    expect(isOriginAllowed('https://trackvid.in', ALLOWED)).toBe(true)
    expect(isOriginAllowed('http://localhost:3000', ALLOWED)).toBe(true)
  })

  it('accepts subdomains of a wildcard, at any depth', () => {
    expect(isOriginAllowed('https://app.trackvid.in', ALLOWED)).toBe(true)
    expect(isOriginAllowed('https://a.b.trackvid.in', ALLOWED)).toBe(true)
  })

  it('refuses look-alike hosts', () => {
    expect(isOriginAllowed('https://eviltrackvid.in', ALLOWED)).toBe(false)
    expect(isOriginAllowed('https://trackvid.in.evil.com', ALLOWED)).toBe(false)
    expect(isOriginAllowed('https://app.trackvid.in.evil.com', ALLOWED)).toBe(false)
  })

  it('refuses a different scheme or port', () => {
    expect(isOriginAllowed('http://trackvid.in', ALLOWED)).toBe(false)
    expect(isOriginAllowed('http://app.trackvid.in', ALLOWED)).toBe(false)
    expect(isOriginAllowed('https://trackvid.in:8443', ALLOWED)).toBe(false)
    expect(isOriginAllowed('http://localhost:3001', ALLOWED)).toBe(false)
  })

  it('refuses a missing, opaque or wildcard origin', () => {
    expect(isOriginAllowed(undefined, ALLOWED)).toBe(false)
    expect(isOriginAllowed('null', ALLOWED)).toBe(false)
    expect(isOriginAllowed('https://*.trackvid.in', ALLOWED)).toBe(false)
  })
})

describe('normaliseOrigin', () => {
  it('lower-cases and strips a trailing slash', () => {
    expect(normaliseOrigin('HTTPS://TrackVid.in/')).toBe('https://trackvid.in')
    expect(normaliseOrigin('https://*.TrackVid.in')).toBe('https://*.trackvid.in')
  })

  it('drops a default port', () => {
    expect(normaliseOrigin('https://trackvid.in:443')).toBe('https://trackvid.in')
  })

  it('refuses anything that is not a bare origin', () => {
    expect(normaliseOrigin('https://trackvid.in/scan-and-pack')).toBeNull()
    expect(normaliseOrigin('https://trackvid.in?x=1')).toBeNull()
    expect(normaliseOrigin('ftp://trackvid.in')).toBeNull()
    expect(normaliseOrigin('trackvid.in')).toBeNull()
    expect(normaliseOrigin('https://user@trackvid.in')).toBeNull()
  })
})
