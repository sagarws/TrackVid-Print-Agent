import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'

/**
 * JSON files that survive a power cut.
 *
 * A plain write-then-rename is not enough on Windows: the rename is journaled
 * but the new file's bytes may still be in the OS cache, so after the power
 * goes the file can come back empty or full of NULs — and the record is lost.
 *
 * So each save:
 *   1. writes `<file>.tmp` and flushes it to the disk (fsync),
 *   2. moves the current `<file>` to `<file>.bak`,
 *   3. moves `<file>.tmp` to `<file>`.
 *
 * Whenever the power goes, at least one of the three holds a whole copy, and
 * `readDurableJson` takes the first one that parses.
 */

const TMP = '.tmp'
const BAK = '.bak'

export const writeDurableJson = (file: string, value: unknown): void => {
  const temp = file + TMP
  const fd = openSync(temp, 'w')
  try {
    writeSync(fd, JSON.stringify(value))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  if (existsSync(file)) renameSync(file, file + BAK)
  renameSync(temp, file)
}

/**
 * The newest whole copy of `file`: the file itself, else a fully flushed
 * `.tmp` the rename never reached, else the `.bak` from the save before.
 * Throws the first error when none of them parses.
 */
export const readDurableJson = <T>(file: string, isValid: (value: T) => boolean = () => true): T => {
  let firstError: Error | null = null
  for (const candidate of [file, file + TMP, file + BAK]) {
    if (!existsSync(candidate)) continue
    try {
      const value = JSON.parse(readFileSync(candidate, 'utf8')) as T
      if (isValid(value)) return value
      firstError ??= new Error(`${candidate} is not a valid record`)
    } catch (error) {
      firstError ??= error instanceof Error ? error : new Error(String(error))
    }
  }
  throw firstError ?? Object.assign(new Error(`${file} not found`), { code: 'ENOENT' })
}

/** Remove a durable file with its `.tmp` and `.bak`, so a deleted record never comes back. */
export const removeDurableJson = (file: string): void => {
  for (const candidate of [file, file + TMP, file + BAK]) rmSync(candidate, { force: true })
}

/**
 * The record names in a folder of durable files: `abc.json`, `abc.json.tmp`
 * and `abc.json.bak` all give `abc.json`, so a record whose main file was
 * lost mid-save is still found through its backup.
 */
export const durableJsonNames = (names: string[]): string[] =>
  [...new Set(names.filter(name => /\.json(\.tmp|\.bak)?$/.test(name)).map(name => name.replace(/\.(tmp|bak)$/, '')))]
