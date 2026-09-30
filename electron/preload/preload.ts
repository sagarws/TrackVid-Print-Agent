import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/constants/channels'
import type { AgentState, Result, ThemeMode } from '@shared/types/agent'

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
  setAllowedOrigins: (origins: string[]): Promise<Result> => ipcRenderer.invoke(IPC.setAllowedOrigins, origins),
  setOpenAtLogin: (enabled: boolean): Promise<Result> => ipcRenderer.invoke(IPC.setOpenAtLogin, enabled),
  setThemeMode: (mode: ThemeMode): Promise<Result> => ipcRenderer.invoke(IPC.setThemeMode, mode)
}

export type PrintAgentApi = typeof api

contextBridge.exposeInMainWorld('printAgent', api)
