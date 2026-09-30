import { decodePDFRawStream, PDFArray, PDFDict, PDFName, PDFRawStream, type PDFPage } from 'pdf-lib'

/**
 * Trim a page's resources to what it actually draws, before it is copied out.
 *
 * WHY. Some label PDFs (Flipkart's, for one) give every page the same resource
 * dictionary — every image and font of the whole file. pdf-lib copies whatever
 * a page references, so cutting ONE label out of a 684-page, 22 MB file
 * produced a 20 MB one-page PDF: 12 GB of disk for a packlog, ~1.7 s a cut, and
 * a preview too heavy to show.
 *
 * HOW. The page's content stream names every resource it uses (`/Im12 Do`,
 * `/F1 12 Tf`, `/GS0 gs` …). Each resource category below is replaced, for
 * this page only, by a copy holding just the names that appear in the content.
 * The shared dictionary itself is left untouched, so other pages are unaffected.
 *
 * Safe by construction: if the content cannot be read (an unknown stream
 * type), nothing is changed and the page is copied as before.
 */
const PRUNABLE = new Set(['XObject', 'Font', 'ExtGState', 'Pattern', 'Shading', 'ColorSpace', 'Properties'])

const latin1 = new TextDecoder('latin1')

/** Every `/Name` token in the page's content, or null if it cannot be read. */
const namesUsed = (page: PDFPage): Set<string> | null => {
  const contents = page.node.Contents()
  const streams: unknown[] = []
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) streams.push(contents.lookup(i))
  } else if (contents) {
    streams.push(contents)
  }
  let text = ''
  for (const stream of streams) {
    // Parsed files hold raw streams; anything else (built in memory) is left alone.
    if (!(stream instanceof PDFRawStream)) return null
    try {
      text += latin1.decode(decodePDFRawStream(stream).decode())
    } catch {
      // An unsupported filter: keep every resource rather than guess.
      return null
    }
    text += '\n'
  }
  const names = new Set<string>()
  for (const match of text.matchAll(/\/([^\s/[\]<>(){}%]+)/g)) names.add(match[1] ?? '')
  return names
}

export interface PruneResult {
  kept: number
  dropped: number
}

export const prunePageResources = (page: PDFPage): PruneResult | null => {
  const names = namesUsed(page)
  const resources = page.node.Resources()
  if (!names || !resources) return null
  const context = page.node.context
  const trimmed = PDFDict.withContext(context)
  let kept = 0
  let dropped = 0
  for (const [key, value] of resources.entries()) {
    const category = key.decodeText()
    const sub = context.lookup(value)
    if (!PRUNABLE.has(category) || !(sub instanceof PDFDict)) {
      trimmed.set(key, value)
      continue
    }
    const only = PDFDict.withContext(context)
    for (const [name, ref] of sub.entries()) {
      if (names.has(name.decodeText()) || names.has(name.asString().slice(1))) {
        only.set(name, ref)
        kept++
      } else {
        dropped++
      }
    }
    trimmed.set(key, only)
  }
  page.node.set(PDFName.of('Resources'), trimmed)
  return { kept, dropped }
}
