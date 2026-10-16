import { crc32, deflateRawSync } from 'node:zlib'

/**
 * A minimal ZIP writer (deflate, UTF-8 names, no ZIP64) for the label bundle
 * download: a few hundred PDFs, well under 4 GB, so the plain format is enough
 * and no dependency is needed. Folders are just "/" in an entry's name.
 */
export const zipFiles = (files: { name: string; data: Buffer }[]): Buffer => {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  // DOS date/time of "now" — every entry gets the same stamp.
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const packed = deflateRawSync(file.data)
    // Store as is when deflate does not help (already-compressed PDF streams).
    const deflated = packed.length < file.data.length
    const body = deflated ? packed : file.data
    const crc = crc32(file.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // flags: UTF-8 names
    local.writeUInt16LE(deflated ? 8 : 0, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, name, body)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4) // version made by
    entry.writeUInt16LE(20, 6) // version needed
    entry.writeUInt16LE(0x0800, 8)
    entry.writeUInt16LE(deflated ? 8 : 0, 10)
    entry.writeUInt16LE(time, 12)
    entry.writeUInt16LE(date, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(body.length, 20)
    entry.writeUInt32LE(file.data.length, 24)
    entry.writeUInt16LE(name.length, 28)
    // extra, comment, disk, internal attrs, external attrs: all zero
    entry.writeUInt32LE(offset, 42)
    central.push(entry, name)

    offset += local.length + name.length + body.length
  }

  const centralSize = central.reduce((sum, b) => sum + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, ...central, end])
}
