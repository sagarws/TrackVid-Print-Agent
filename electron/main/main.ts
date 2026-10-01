import { app, BrowserWindow, session } from 'electron'
import { APP_ID } from '@shared/constants/agent'
import { IPC, SCANPACK_IPC } from '@shared/constants/channels'
import { registerIpc, setOpenAtLogin } from './ipc'
import { registerScanPackIpc } from './scanpack/ipc'
import { getJob, listJobs, onJobChanged, startExtraction, stopExtraction } from './scanpack/extractor'
import { startScanPackCleanup, stopScanPackCleanup } from './scanpack/retention'
import { flushScanPack } from './scanpack/store'
import { applyOpenAtLogin, launchedHidden } from './loginItem'
import { logger } from './logger'
import { setPrinterSource, startPrinterMonitor, stopPrinterMonitor } from './printers'
import { startServer, stopServer } from './server'
import { getSettings } from './settings'
import { snapshot, subscribe } from './state'
import { createTray, destroyTray, updateTray } from './tray'
import { createWindow, markQuitting, showWindow } from './window'

app.setAppUserModelId(APP_ID)

/*
 * One agent per machine: a second copy could not bind the port anyway, so it
 * just brings the running one's window forward and exits.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  const quit = (): void => {
    markQuitting()
    app.quit()
  }
  const trayActions = { toggleOpenAtLogin: setOpenAtLogin, quit }

  void app.whenReady().then(() => {
    logger.info('Starting', { version: app.getVersion(), platform: process.platform, arch: process.arch })

    applyContentSecurityPolicy()
    registerIpc()
    registerScanPackIpc()

    const hidden = launchedHidden()
    if (hidden && process.platform === 'darwin') app.dock?.hide()

    const window = createWindow({ show: !hidden })
    setPrinterSource(window.webContents)

    // Keep the saved choice and the OS login item in step on every start —
    // the first packaged run registers itself here.
    applyOpenAtLogin(getSettings().openAtLogin)

    createTray(snapshot(), trayActions)
    const unsubscribe = subscribe(state => {
      updateTray(state, trayActions)
      if (!window.isDestroyed()) window.webContents.send(IPC.state, state)
    })
    app.once('will-quit', unsubscribe)

    startServer()
    // Scan & Pack retention: drop weeks older than the Settings window, now and every 6 h.
    startScanPackCleanup()
    // Background per-order PDF extraction: live updates to the window, and
    // any job a quit interrupted picks up where it stopped.
    onJobChanged(jobId => {
      if (!window.isDestroyed()) window.webContents.send(SCANPACK_IPC.jobChanged, { jobs: listJobs(), job: getJob(jobId) })
    })
    startExtraction()
    startPrinterMonitor()

    app.on('activate', () => showWindow())
  })

  // The window only hides, so this fires only on quit — but make that explicit:
  // the agent lives in the tray, not in its window.
  app.on('window-all-closed', () => undefined)

  app.on('before-quit', () => {
    markQuitting()
    logger.info('Shutting down')
    stopPrinterMonitor()
    stopScanPackCleanup()
    stopExtraction()
    // Pending packed-status writes must reach disk before the process ends.
    flushScanPack()
    void stopServer()
    destroyTray()
    BrowserWindow.getAllWindows().forEach(window => window.destroy())
  })
}

function applyContentSecurityPolicy(): void {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  // 'wasm-unsafe-eval': the Scan & Pack barcode reader (zxing) is WebAssembly.
  const scriptSrc = devServer ? "'self' 'unsafe-inline' 'wasm-unsafe-eval'" : "'self' 'wasm-unsafe-eval'"
  const dev = devServer ? ` ${devServer}` : ''
  // The TrackVid backend the login and API calls go to (VITE_APP_BASE_URL).
  const api = apiOrigin()

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          // worker-src: pdf.js (scanning and the label preview) runs in a worker.
          `default-src 'self'; script-src ${scriptSrc}; worker-src 'self' blob:${dev}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:${api ? ` ${api}` : ''} ${devServer ? `${devServer} ws:` : ''}; object-src 'none'; base-uri 'none'; form-action 'none'`
        ]
      }
    })
  })
}

/** Origin of VITE_APP_BASE_URL (e.g. https://api.trackvid.in), or '' if unset / invalid. */
function apiOrigin(): string {
  try {
    return new URL(import.meta.env.VITE_APP_BASE_URL ?? 'http://localhost:8000').origin
  } catch {
    return ''
  }
}
