import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { WINDOW_DEFAULTS } from '@shared/constants/agent'
import { logger } from './logger'

/**
 * The one window. Created at startup (hidden when launched at login) and only
 * ever hidden afterwards, never destroyed: the agent keeps serving print jobs
 * with it closed, and the printer list is read through its WebContents.
 */
let window: BrowserWindow | null = null
let quitting = false

export const markQuitting = (): void => {
  quitting = true
}

const rendererEntry = (): { url: string } | { file: string } => {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devServer) return { url: devServer }
  return { file: join(__dirname, '../renderer/index.html') }
}

/** The renderer's own origin — the only one allowed to use the IPC bridge. */
export const isRendererUrl = (url: string): boolean => {
  const entry = rendererEntry()
  return 'url' in entry ? url.startsWith(entry.url) : url.startsWith('file://')
}

export const createWindow = (options: { show: boolean }): BrowserWindow => {
  const icon = app.isPackaged ? undefined : join(app.getAppPath(), 'build', 'icon.png')

  window = new BrowserWindow({
    width: WINDOW_DEFAULTS.width,
    height: WINDOW_DEFAULTS.height,
    minWidth: WINDOW_DEFAULTS.minWidth,
    minHeight: WINDOW_DEFAULTS.minHeight,
    show: false,
    title: 'TrackVid Print Agent',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      /*
       * Keep timers running at full speed while the window is hidden, behind
       * another app or minimised. The agent is a background app, and Chromium's
       * default throttling (timers down to 1/s, then ~1/min) stretched a Scan &
       * Pack upload from under a second to minutes whenever the packer switched
       * to another window — pdf-lib and the upload queue both wait on timers.
       */
      backgroundThrottling: false
    }
  })

  if (options.show) window.once('ready-to-show', () => showWindow())

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (!isRendererUrl(url)) {
      event.preventDefault()
      logger.warn('Blocked in-app navigation', { url })
    }
  })

  // Closing hides. The agent has to keep running for the web app to print;
  // quitting is explicit, from the tray.
  window.on('close', event => {
    if (quitting) return
    event.preventDefault()
    window?.hide()
    if (process.platform === 'darwin') app.dock?.hide()
  })

  const entry = rendererEntry()
  if ('url' in entry) void window.loadURL(entry.url)
  else void window.loadFile(entry.file)

  return window
}

export const getWindow = (): BrowserWindow | null => (window && !window.isDestroyed() ? window : null)

export const showWindow = (): void => {
  const current = getWindow()
  if (!current) return
  if (process.platform === 'darwin') void app.dock?.show()
  if (current.isMinimized()) current.restore()
  current.show()
  current.focus()
}
