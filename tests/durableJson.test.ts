import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { durableJsonNames, readDurableJson, removeDurableJson, writeDurableJson } from '../electron/main/durableJson'

describe('durableJson', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'durable-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps the previous save as a backup', () => {
    const file = join(dir, 'a.json')
    writeDurableJson(file, { n: 1 })
    writeDurableJson(file, { n: 2 })
    expect(readDurableJson(file)).toEqual({ n: 2 })
    expect(readDurableJson(`${file}.bak`)).toEqual({ n: 1 })
  })

  it('recovers from the backup when a power cut left the file empty or full of NULs', () => {
    const file = join(dir, 'a.json')
    writeDurableJson(file, { n: 1 })
    writeDurableJson(file, { n: 2 })
    writeFileSync(file, '')
    expect(readDurableJson(file)).toEqual({ n: 1 })
    writeFileSync(file, Buffer.alloc(64))
    expect(readDurableJson(file)).toEqual({ n: 1 })
  })

  it('recovers a flushed .tmp the rename never reached, even with the main file gone', () => {
    const file = join(dir, 'a.json')
    writeFileSync(`${file}.tmp`, JSON.stringify({ n: 3 }))
    expect(durableJsonNames(readdirSync(dir))).toEqual(['a.json'])
    expect(readDurableJson(file)).toEqual({ n: 3 })
  })

  it('skips copies that fail validation', () => {
    const file = join(dir, 'a.json')
    writeDurableJson(file, { ok: true })
    writeDurableJson(file, { ok: false })
    expect(readDurableJson<{ ok: boolean }>(file, v => v.ok)).toEqual({ ok: true })
  })

  it('removes every copy, so a deleted record does not come back', () => {
    const file = join(dir, 'a.json')
    writeDurableJson(file, 1)
    writeDurableJson(file, 2)
    removeDurableJson(file)
    expect(existsSync(file) || existsSync(`${file}.bak`)).toBe(false)
    expect(() => readDurableJson(file)).toThrow()
  })
})
