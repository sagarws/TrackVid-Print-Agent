import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, SCANPACK_IPC } from '@shared/constants/channels'
import type { AgentState, Result, ThemeMode } from '@shared/types/agent'
import type { CleanupSummary, CreatePacklogInput, PartName } from '@shared/types/scanpack'

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
