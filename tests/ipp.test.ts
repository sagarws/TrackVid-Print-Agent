import { describe, expect, it } from 'vitest'
import { baseAttributes, decodeResponse, encodeRequest, IPP_OP, requested } from '@main/print/ipp'

/** Builds a response the way a printer would: header, groups, end tag. */
const response = (status: number, groups: [number, [number, string, Buffer][]][]): Buffer => {
  const parts: Buffer[] = [Buffer.from([1, 1, status >> 8, status & 0xff, 0, 0, 0, 1])]
  for (const [tag, attributes] of groups) {
    parts.push(Buffer.from([tag]))
    for (const [valueTag, name, value] of attributes) {
      const head = Buffer.alloc(3)
      head.writeUInt8(valueTag, 0)
      head.writeUInt16BE(name.length, 1)
      const length = Buffer.alloc(2)
      length.writeUInt16BE(value.length)
      parts.push(head, Buffer.from(name), length, value)
    }
  }
  parts.push(Buffer.from([3]))
  return Buffer.concat(parts)
}
const int = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeInt32BE(n)
  return b
}

describe('IPP encoding', () => {
  it('writes the header, operation attributes and end tag', () => {
    const body = encodeRequest(IPP_OP.getPrinterAttributes, 7, [
      ...baseAttributes('printer-uri', 'ipp://localhost/printers/P'),
      requested('printer-state', 'marker-levels')
    ])
    expect([...body.subarray(0, 8)]).toEqual([1, 1, 0x00, 0x0b, 0, 0, 0, 7])
    expect(body[8]).toBe(0x01)
    expect(body[body.length - 1]).toBe(0x03)
    const text = body.toString('latin1')
    expect(text).toContain('attributes-charset')
    expect(text).toContain('ipp://localhost/printers/P')
    // The second keyword is an additional value: empty name.
    expect(text).toContain('\x44\x00\x00\x00\x0dmarker-levels')
  })
})

describe('IPP decoding', () => {
  it('reads groups, multi-valued attributes and integers', () => {
    const decoded = decodeResponse(
      response(0, [
        [0x01, [[0x47, 'attributes-charset', Buffer.from('utf-8')]]],
        [
          0x04,
          [
            [0x23, 'printer-state', int(5)],
            [0x44, 'printer-state-reasons', Buffer.from('paused')],
            [0x44, '', Buffer.from('media-empty-error')],
            [0x22, 'printer-is-accepting-jobs', Buffer.from([1])],
            [0x21, 'marker-levels', int(40)],
            [0x21, '', int(-1)]
          ]
        ]
      ])
    )
    expect(decoded.status).toBe(0)
    const printer = decoded.groups[1]?.attributes
    expect(printer?.['printer-state']).toEqual([5])
    expect(printer?.['printer-state-reasons']).toEqual(['paused', 'media-empty-error'])
    expect(printer?.['printer-is-accepting-jobs']).toEqual([true])
    expect(printer?.['marker-levels']).toEqual([40, -1])
  })

  it('walks past collections without mixing their members into other attributes', () => {
    const decoded = decodeResponse(
      response(0, [
        [
          0x04,
          [
            [0x34, 'media-col-default', Buffer.alloc(0)],
            [0x4a, '', Buffer.from('media-size')],
            [0x34, '', Buffer.alloc(0)],
            [0x4a, '', Buffer.from('x-dimension')],
            [0x21, '', int(21000)],
            [0x37, '', Buffer.alloc(0)],
            [0x37, '', Buffer.alloc(0)],
            [0x42, 'printer-name', Buffer.from('Epson')]
          ]
        ]
      ])
    )
    const printer = decoded.groups[0]?.attributes
    expect(printer?.['media-col-default']).toEqual([null])
    expect(printer?.['printer-name']).toEqual(['Epson'])
  })

  it('refuses a truncated response', () => {
    const full = response(0, [[0x04, [[0x42, 'printer-name', Buffer.from('Epson')]]]])
    expect(() => decodeResponse(full.subarray(0, full.length - 4))).toThrow()
  })
})
