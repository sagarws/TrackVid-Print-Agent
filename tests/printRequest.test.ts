import { describe, expect, it } from 'vitest'
import { parsePrintOptions, parsePrintRequest } from '@shared/utils/printRequest'

const pdf = Buffer.from('%PDF-1.4 test').toString('base64')

describe('parsePrintRequest', () => {
  it('still takes the original { printer, pdfBase64 } body', () => {
    expect(parsePrintRequest({ printer: 'Epson', pdfBase64: pdf })).toMatchObject({
      printer: 'Epson',
      format: 'pdf',
      jobName: 'TrackVid print',
      options: {},
      allowOffline: false
    })
  })

  it('takes raw jobs as base64 or text', () => {
    expect(parsePrintRequest({ printer: 'Zebra', format: 'raw', text: '^XA^XZ' }).bytes.toString()).toBe('^XA^XZ')
    expect(parsePrintRequest({ printer: 'Zebra', format: 'raw', data: Buffer.from('N\n').toString('base64') }).bytes.toString()).toBe('N\n')
  })

  it('refuses a "pdf" that is not one, and unknown formats', () => {
    expect(() => parsePrintRequest({ printer: 'Epson', data: Buffer.from('hello').toString('base64') })).toThrow('not a PDF')
    expect(() => parsePrintRequest({ printer: 'Epson', format: 'html', data: pdf })).toThrow('format')
    expect(() => parsePrintRequest({ printer: '', data: pdf })).toThrow('printer')
  })
})

describe('parsePrintOptions', () => {
  it('accepts valid options', () => {
    expect(
      parsePrintOptions({ copies: 3, pages: '1-2, 4', orientation: 'landscape', paperSize: '4x6', scale: 'shrink', duplex: 'one-sided', color: false })
    ).toEqual({ copies: 3, pages: '1-2,4', orientation: 'landscape', paperSize: '4x6', scale: 'shrink', duplex: 'one-sided', color: false })
  })

  it('refuses values that could smuggle extra settings', () => {
    expect(() => parsePrintOptions({ paperSize: 'A4,landscape' })).toThrow()
    expect(() => parsePrintOptions({ pages: '1;rm' })).toThrow()
    expect(() => parsePrintOptions({ copies: 0 })).toThrow()
    expect(() => parsePrintOptions({ copies: 2.5 })).toThrow()
    expect(() => parsePrintOptions('fit')).toThrow()
  })
})
