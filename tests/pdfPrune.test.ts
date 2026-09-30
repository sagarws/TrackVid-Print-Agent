import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName, drawObject, popGraphicsState, pushGraphicsState, concatTransformationMatrix } from 'pdf-lib'
import { prunePageResources } from '@shared/utils/pdfPrune'

/**
 * A label PDF shaped like the one that produced 20 MB one-page cuts: every
 * page shares ONE resource dictionary holding every page's image.
 */
const sharedResourcePdf = async (pages: number) => {
  const doc = await PDFDocument.create()
  const images = PDFDict.withContext(doc.context)
  for (let i = 1; i <= pages; i++) {
    const image = doc.context.stream(randomBytes(150 * 150), {
      Type: 'XObject',
      Subtype: 'Image',
      Width: 150,
      Height: 150,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 8
    })
    images.set(PDFName.of(`Im${i}`), doc.context.register(image))
  }
  const shared = doc.context.register(doc.context.obj({ XObject: images }))
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([288, 432])
    page.node.set(PDFName.of('Resources'), shared)
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(150, 0, 0, 150, 20, 20), drawObject(`Im${i}`), popGraphicsState())
  }
  // Round-trip, so the pages hold parsed (raw) content streams like a real file.
  return PDFDocument.load(await doc.save())
}

const cut = async (source: PDFDocument, index: number, prune: boolean) => {
  if (prune) prunePageResources(source.getPage(index))
  const out = await PDFDocument.create()
  const [page] = await out.copyPages(source, [index])
  out.addPage(page)
  return out.save()
}

describe('prunePageResources', () => {
  it('keeps a one-page cut small when every page shares all the images', async () => {
    const source = await sharedResourcePdf(60)
    const whole = await cut(source, 4, false)
    const trimmed = await cut(await sharedResourcePdf(60), 4, true)
    // Without pruning the cut carries all 60 images (~1.35 MB); with it, one.
    expect(whole.length).toBeGreaterThan(1_000_000)
    expect(trimmed.length).toBeLessThan(40_000)
  })

  it('keeps exactly the image the page draws', async () => {
    const source = await sharedResourcePdf(10)
    const result = prunePageResources(source.getPage(6))
    expect(result).toEqual({ kept: 1, dropped: 9 })
    const xobjects = source.getPage(6).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
    expect(xobjects.keys().map(k => k.decodeText())).toEqual(['Im7'])
  })

  it('leaves the other pages (and the shared dictionary) intact', async () => {
    const source = await sharedResourcePdf(10)
    prunePageResources(source.getPage(2))
    const other = source.getPage(3).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
    expect(other.keys()).toHaveLength(10)
  })
})
