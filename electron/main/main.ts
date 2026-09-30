import { app, BrowserWindow, session } from 'electron'
import { APP_ID } from '@shared/constants/agent'
import { IPC } from '@shared/constants/channels'
import { registerIpc, setOpenAtLogin } from './ipc'
import { applyOpenAtLogin, launchedHidden } from './loginItem'
import { logger } from './logger'
import { refreshPrinters, setPrinterSource } from './printers'
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
    void refreshPrinters()

    app.on('activate', () => showWindow())
  })

  // The window only hides, so this fires only on quit — but make that explicit:
  // the agent lives in the tray, not in its window.
  app.on('window-all-closed', () => undefined)

  app.on('before-quit', () => {
    markQuitting()
    logger.info('Shutting down')
    void stopServer()
    destroyTray()
    BrowserWindow.getAllWindows().forEach(window => window.destroy())
  })
}

function applyContentSecurityPolicy(): void {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  const scriptSrc = devServer ? "'self' 'unsafe-inline'" : "'self'"

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ${devServer ? `${devServer} ws:` : ''}; object-src 'none'; base-uri 'none'; form-action 'none'`
        ]
      }
    })
  })
}
