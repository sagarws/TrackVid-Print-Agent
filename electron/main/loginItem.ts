import { app } from 'electron'
import { logger } from './logger'

/** Passed to the login item so a start at login stays in the tray. */
export const HIDDEN_ARG = '--hidden'

export const applyOpenAtLogin = (enabled: boolean): void => {
  // A dev run must never register node_modules/electron as a login item.
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_ARG] })
  } catch (error) {
    logger.error('Could not change the login item', error)
  }
}

export const launchedHidden = (): boolean =>
  process.argv.includes(HIDDEN_ARG) || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin)
