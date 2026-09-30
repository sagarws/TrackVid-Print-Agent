import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, SCANPACK_IPC } from '@shared/constants/channels'
import type { AgentState, Result, ThemeMode } from '@shared/types/agent'
import type {
  CleanupSummary,
  CreatePacklogInput,
  ExtractionJob,
  ExtractionJobSummary,
  PartName
} from '@shared/types/scanpack'

/**
 * The window's whole reach into the main process. Nothing else is exposed:
 * no ipcRenderer, no Node.
 */
const api = {
  getState: (): Promise<AgentState | null> => ipcRenderer.invoke(IPC.getState),
  onState: (listener: (state: AgentState) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, state: AgentState) => listener(state)
    ipcRenderer.on(IPC.state, handler)
    return () => ipcRenderer.removeListener(IPC.state, handler)
  },
  refreshPrinters: (): Promise<Result> => ipcRenderer.invoke(IPC.refreshPrinters),
  testPrint: (printer: string): Promise<Result> => ipcRenderer.invoke(IPC.testPrint, printer),
  setOpenAtLogin: (enabled: boolean): Promise<Result> => ipcRenderer.invoke(IPC.setOpenAtLogin, enabled),
  setThemeMode: (mode: ThemeMode): Promise<Result> => ipcRenderer.invoke(IPC.setThemeMode, mode),
  setBlockOfflinePrinters: (enabled: boolean): Promise<Result> => ipcRenderer.invoke(IPC.setBlockOfflinePrinters, enabled),
  setNotifications: (enabled: boolean): Promise<Result> => ipcRenderer.invoke(IPC.setNotifications, enabled),
  resumePrinter: (printer: string): Promise<Result> => ipcRenderer.invoke(IPC.resumePrinter, printer),
  clearQueue: (printer: string): Promise<Result> => ipcRenderer.invoke(IPC.clearQueue, printer),
  cancelQueueJob: (printer: string, osJobId: string): Promise<Result> =>
    ipcRenderer.invoke(IPC.cancelQueueJob, printer, osJobId),
  releaseQueueJob: (printer: string, osJobId: string): Promise<Result> =>
    ipcRenderer.invoke(IPC.releaseQueueJob, printer, osJobId),
  cancelJob: (id: string): Promise<Result> => ipcRenderer.invoke(IPC.cancelJob, id),
  releaseJob: (id: string): Promise<Result> => ipcRenderer.invoke(IPC.releaseJob, id),
  reprintJob: (id: string): Promise<Result> => ipcRenderer.invoke(IPC.reprintJob, id),
  openPrinterSettings: (): Promise<Result> => ipcRenderer.invoke(IPC.openPrinterSettings),

  /** Scan & Pack's local backend — see electron/main/scanpack. */
  scanPack: {
    create: (input: CreatePacklogInput): Promise<Result<unknown>> => ipcRenderer.invoke(SCANPACK_IPC.create, input),
    list: (opts: { page?: number; limit?: number; platform?: string }): Promise<Result<unknown>> =>
      ipcRenderer.invoke(SCANPACK_IPC.list, opts),
    get: (id: string): Promise<Result<unknown>> => ipcRenderer.invoke(SCANPACK_IPC.get, id),
    remove: (id: string): Promise<Result<unknown>> => ipcRenderer.invoke(SCANPACK_IPC.remove, id),
    upload: (id: string, orderId: string, part: PartName, bytes: Uint8Array, pageCount: number): Promise<Result<unknown>> =>
      ipcRenderer.invoke(SCANPACK_IPC.upload, id, orderId, part, bytes, pageCount),
    download: (id: string, orderId: string, part: PartName): Promise<Result<Uint8Array>> =>
      ipcRenderer.invoke(SCANPACK_IPC.download, id, orderId, part),
    markPacked: (id: string, orderId: string): Promise<Result<unknown>> =>
      ipcRenderer.invoke(SCANPACK_IPC.markPacked, id, orderId),
    saveSource: (id: string, docId: string, name: string, bytes: Uint8Array, pageCount: number): Promise<Result<unknown>> =>
      ipcRenderer.invoke(SCANPACK_IPC.saveSource, id, docId, name, bytes, pageCount),
    mapOrders: (
      id: string,
      maps: { orderId: string; docId: string; labelPages: number[]; invoicePages: number[] }[]
    ): Promise<Result<{ mapped: number; mappedCount: number; jobId: string | null; workers: number }>> =>
      ipcRenderer.invoke(SCANPACK_IPC.mapOrders, id, maps),
    waitForFirst: (jobId: string, count: number): Promise<Result<ExtractionJob | null>> =>
      ipcRenderer.invoke(SCANPACK_IPC.waitForFirst, jobId, count),
    listJobs: (): Promise<Result<ExtractionJobSummary[]>> => ipcRenderer.invoke(SCANPACK_IPC.listJobs),
    getJob: (jobId: string): Promise<Result<ExtractionJob | null>> => ipcRenderer.invoke(SCANPACK_IPC.getJob, jobId),
    deleteJob: (jobId: string): Promise<Result<ExtractionJobSummary[]>> => ipcRenderer.invoke(SCANPACK_IPC.deleteJob, jobId),
    rerunJob: (jobId: string): Promise<Result<ExtractionJobSummary[]>> => ipcRenderer.invoke(SCANPACK_IPC.rerunJob, jobId),
    setWorkers: (workers: number): Promise<Result<number>> => ipcRenderer.invoke(SCANPACK_IPC.setWorkers, workers),
    saveDownload: (bytes: Uint8Array, fileName: string): Promise<Result<string>> =>
      ipcRenderer.invoke(SCANPACK_IPC.saveDownload, bytes, fileName),
    onJobChanged: (listener: (update: { jobs: ExtractionJobSummary[]; job: ExtractionJob | null }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, update: { jobs: ExtractionJobSummary[]; job: ExtractionJob | null }) =>
        listener(update)
      ipcRenderer.on(SCANPACK_IPC.jobChanged, handler)
      return () => ipcRenderer.removeListener(SCANPACK_IPC.jobChanged, handler)
    },
    printPart: (id: string, orderId: string, parts: PartName[], printer: string, jobName: string): Promise<Result<unknown>> =>
      ipcRenderer.invoke(SCANPACK_IPC.printPart, id, orderId, parts, printer, jobName),
    print: (printer: string, bytes: Uint8Array, jobName: string): Promise<Result<{ jobId: string; status: string }>> =>
      ipcRenderer.invoke(SCANPACK_IPC.print, printer, bytes, jobName),
    chooseDir: (): Promise<Result<string | null>> => ipcRenderer.invoke(SCANPACK_IPC.chooseDir),
    resetDir: (): Promise<Result<string>> => ipcRenderer.invoke(SCANPACK_IPC.resetDir),
    openDir: (): Promise<Result> => ipcRenderer.invoke(SCANPACK_IPC.openDir),
    setWeeksKept: (weeks: number): Promise<Result<CleanupSummary>> => ipcRenderer.invoke(SCANPACK_IPC.setWeeksKept, weeks),
    runCleanup: (): Promise<Result<CleanupSummary>> => ipcRenderer.invoke(SCANPACK_IPC.runCleanup),
    /** Timing lines for the terminal. Fire-and-forget: never slows what it measures. */
    perf: (lines: string[]): void => ipcRenderer.send(SCANPACK_IPC.perf, lines)
  }
}

export type PrintAgentApi = typeof api

contextBridge.exposeInMainWorld('printAgent', api)
