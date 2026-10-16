import { decodePDFRawStream, PDFArray, PDFDict, PDFName, PDFRawStream, type PDFContext, type PDFPage } from 'pdf-lib'

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

/** Every `/Name` token in these content streams, or null if one cannot be read. */
const namesIn = (streams: unknown[]): Set<string> | null => {
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

/** Every `/Name` token in the page's content, or null if it cannot be read. */
const namesUsed = (page: PDFPage): Set<string> | null => {
  const contents = page.node.Contents()
  const streams: unknown[] = []
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) streams.push(contents.lookup(i))
  } else if (contents) {
    streams.push(contents)
  }
  return namesIn(streams)
}

export interface PruneResult {
  kept: number
  dropped: number
}

/** A copy of `resources` holding, per prunable category, only the names in `names`. */
const trim = (context: PDFContext, resources: PDFDict, names: Set<string>, result: PruneResult) => {
  const trimmed = PDFDict.withContext(context)
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
        result.kept++
      } else {
        result.dropped++
      }
    }
    trimmed.set(key, only)
  }
  return trimmed
}

/**
 * Form XObjects (templates) the trimmed resources still name get the same
 * treatment against their own content. Flipkart's labels draw one template per
 * page (`/TPL0 Do`) whose own resource dictionary is shared too — every image
 * and font of the file — so trimming only the page still copied ~5.9 MB per
 * label. A form's resources are trimmed by what that form itself draws, which
 * is correct for every page that uses it, so it is done in place, once.
 */
const pruneForms = (context: PDFContext, resources: PDFDict, result: PruneResult, seen: Set<PDFRawStream>, depth: number) => {
  if (depth > 8) return
  const xobjects = context.lookup(resources.get(PDFName.of('XObject')))
  if (!(xobjects instanceof PDFDict)) return
  for (const [, ref] of xobjects.entries()) {
    const form = context.lookup(ref)
    if (!(form instanceof PDFRawStream) || seen.has(form)) continue
    seen.add(form)
    if (form.dict.get(PDFName.of('Subtype'))?.toString() !== '/Form') continue
    const own = context.lookup(form.dict.get(PDFName.of('Resources')))
    if (!(own instanceof PDFDict)) continue
    const names = namesIn([form])
    if (!names) continue
    const trimmed = trim(context, own, names, result)
    form.dict.set(PDFName.of('Resources'), trimmed)
    pruneForms(context, trimmed, result, seen, depth + 1)
  }
}

export const prunePageResources = (page: PDFPage): PruneResult | null => {
  const names = namesUsed(page)
  const resources = page.node.Resources()
  if (!names || !resources) return null
  const context = page.node.context
  const result: PruneResult = { kept: 0, dropped: 0 }
  const trimmed = trim(context, resources, names, result)
  page.node.set(PDFName.of('Resources'), trimmed)
  pruneForms(context, trimmed, result, new Set(), 0)
  return result
}
