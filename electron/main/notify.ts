import { Notification } from 'electron'
import { logger } from './logger'
import { getSettings } from './settings'
import { showWindow } from './window'

/**
 * A desktop notification, for the moments a packer has to do something at the
 * printer: it went offline, ran out of paper, or a job failed. Nothing is shown
 * for things that went right. The same message is not repeated within a minute.
 */
const recent = new Map<string, number>()
const REPEAT_AFTER_MS = 60_000

export const notifyUser = (title: string, body: string): void => {
  if (!getSettings().notifications || !Notification.isSupported()) return
  const key = `${title}\n${body}`
  const last = recent.get(key)
  if (last && Date.now() - last < REPEAT_AFTER_MS) return
  recent.set(key, Date.now())
  try {
    const notification = new Notification({ title, body, silent: false })
    notification.on('click', () => showWindow())
    notification.show()
  } catch (error) {
    logger.warn('Could not show a notification', error)
  }
}
