import type { WebContents } from 'electron'
import type { AgentPrinter } from '@shared/types/agent'
import { logger } from './logger'
import { readDefaultPrinter } from './print/defaultPrinter'
import { getPrinters, setPrinters } from './state'

/**
 * The OS printer list, read through Chromium — the same list the system print
 * dialog shows, on both platforms, with no shelling out.
 *
 * It needs a WebContents to ask. The main window is created at startup and is
 * only ever hidden, never destroyed, so it is always there to ask through.
 */
let source: WebContents | null = null

export const setPrinterSource = (contents: WebContents): void => {
  source = contents
}

export const refreshPrinters = async (): Promise<AgentPrinter[]> => {
  if (!source || source.isDestroyed()) {
    setPrinters([], 'The agent window is not ready yet.')
    return []
  }
  try {
    const [found, defaultName] = await Promise.all([source.getPrintersAsync(), readDefaultPrinter()])
    const printers = found
      .map(printer => ({
        name: printer.name,
        displayName: printer.displayName || printer.name,
        isDefault: printer.name === defaultName
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
    setPrinters(printers)
    return printers
  } catch (error) {
    logger.error('Could not list printers', error)
    setPrinters([], error instanceof Error ? error.message : 'Could not list printers.')
    return []
  }
}

/**
 * Is this a printer the OS actually has? Checked before every job, so a print
 * request can only ever name a real device. Refreshes once on a miss, in case
 * the printer was plugged in after the list was last read.
 */
export const findPrinter = async (name: string): Promise<AgentPrinter | undefined> => {
  const known = getPrinters().find(printer => printer.name === name)
  if (known) return known
  return (await refreshPrinters()).find(printer => printer.name === name)
}
