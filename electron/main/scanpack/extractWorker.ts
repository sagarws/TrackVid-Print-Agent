/**
 * One Scan & Pack PDF extractor. Runs in its own Electron utility process —
 * one of N, N set in Settings — so the extractors use separate CPU cores and a
 * slow label PDF never blocks the app.
 *
 * It is given its share of an upload's records (round-robin: with 3 workers,
 * worker 1 gets records 1, 4, 7 …), parses each source PDF once, and writes
 * one PDF per order part to the week folder, reporting after each file:
 *
 *   in   { type: 'run', worker, tasks: [{ taskId, record, awb, part, sourceFile, pages, outFile }] }
 *   out  { type: 'start', taskId } | { type: 'done', taskId, file, ms, parseMs, kb }
 *        | { type: 'failed', taskId, error } | { type: 'finished' }
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ParseSpeeds, PDFDocument } from 'pdf-lib'
import { prunePageResources } from '@shared/utils/pdfPrune'

interface Task {
  taskId: string
  record: number
  awb: string
  part: 'label' | 'invoice'
  sourceFile: string
  pages: number[]
  outFile: string
}

type Incoming = { type: 'run'; worker: number; tasks: Task[] }

const port = process.parentPort

const post = (message: Record<string, unknown>): void => port.postMessage(message)

const run = async (tasks: Task[]): Promise<void> => {
  // Each source parsed once per worker, then every task cuts from it.
  const sources = new Map<string, Promise<PDFDocument>>()
  const load = (file: string): { doc: Promise<PDFDocument>; fresh: boolean } => {
    const cached = sources.get(file)
    if (cached) return { doc: cached, fresh: false }
    const doc = readFile(file).then(bytes => PDFDocument.load(bytes, { parseSpeed: ParseSpeeds.Fastest }))
    sources.set(file, doc)
    return { doc, fresh: true }
  }

  for (const task of tasks) {
    post({ type: 'start', taskId: task.taskId })
    const start = performance.now()
    try {
      const { doc, fresh } = load(task.sourceFile)
      const source = await doc
      const parseMs = fresh ? Math.round(performance.now() - start) : 0
      const valid = task.pages.filter(p => p >= 0 && p < source.getPageCount())
      if (!valid.length) throw new Error('The mapped pages are missing from the source PDF.')
      // Copy only what these pages draw — see pdfPrune.ts (20 MB → KB on shared-resource files).
      for (const index of valid) prunePageResources(source.getPage(index))
      const out = await PDFDocument.create()
      for (const page of await out.copyPages(source, valid)) out.addPage(page)
      const bytes = await out.save()
      await mkdir(dirname(task.outFile), { recursive: true })
      await writeFile(task.outFile, bytes)
      post({
        type: 'done',
        taskId: task.taskId,
        file: task.outFile,
        ms: Math.round(performance.now() - start),
        parseMs,
        kb: Math.round(bytes.length / 1024)
      })
    } catch (error) {
      post({ type: 'failed', taskId: task.taskId, error: error instanceof Error ? error.message : String(error) })
    }
  }
  post({ type: 'finished' })
}

port.on('message', (event: { data: Incoming }) => {
  const message = event.data
  if (message?.type === 'run') void run(message.tasks)
})
