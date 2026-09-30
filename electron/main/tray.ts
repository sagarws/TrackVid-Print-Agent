import { join } from 'node:path'
import { app, Menu, nativeImage, Tray } from 'electron'
import type { AgentState } from '@shared/types/agent'
import { showWindow } from './window'

let tray: Tray | null = null

const iconPath = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'trayIcon.png') : join(app.getAppPath(), 'build', 'icon.png')

const statusLine = (state: AgentState): string => {
  switch (state.server.state) {
    case 'listening': {
      const problems = state.printers.filter(printer => ['offline', 'paused', 'error'].includes(printer.status.state))
      if (problems.length === 1 && problems[0]) return `${problems[0].displayName}: ${problems[0].status.message}`
      if (problems.length > 1) return `Ready — ${problems.length} printers need attention`
      return `Ready — ${state.printers.length} printer(s)`
    }
    case 'failed':
      return 'Not running — open for details'
    default:
      return 'Starting…'
  }
}

export const createTray = (
  state: AgentState,
  actions: { toggleOpenAtLogin: (enabled: boolean) => void; quit: () => void }
): void => {
  const image = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 })
  tray = new Tray(image)
  tray.setToolTip('TrackVid Print Agent')
  tray.on('click', () => {
    // Windows opens on a left click; macOS shows the menu, as menu-bar apps do.
    if (process.platform === 'win32') showWindow()
  })
  updateTray(state, actions)
}

export const updateTray = (
  state: AgentState,
  actions: { toggleOpenAtLogin: (enabled: boolean) => void; quit: () => void }
): void => {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: statusLine(state), enabled: false },
      { type: 'separator' },
      { label: 'Open TrackVid Print Agent', click: () => showWindow() },
      {
        label: 'Start when I log in',
        type: 'checkbox',
        checked: state.openAtLogin,
        enabled: app.isPackaged,
        click: item => actions.toggleOpenAtLogin(item.checked)
      },
      { type: 'separator' },
      { label: 'Quit (printing stops)', click: () => actions.quit() }
    ])
  )
}

export const destroyTray = (): void => {
  tray?.destroy()
  tray = null
}
