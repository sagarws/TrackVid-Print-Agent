import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { connect } from 'node:net'
import { promisify } from 'node:util'
import { baseAttributes, IPP_OP, ippRequest, isIppSuccess, nums, num, requested, strs } from './ipp'
import { parseSupplies } from './status'
import type { PrinterConnection, PrinterSupply } from '@shared/types/agent'

const run = promisify(execFile)

/**
 * "Is the printer really there?" — asked of the device, not the OS.
 *
 * The OS print queue only finds out a printer is gone when a job fails, which
 * is how a Wi-Fi printer that was switched off ends up with a paused queue and
 * a pile of held jobs while every print "succeeds". So each refresh the agent
 * reaches out itself:
 *
 *   IPP printers (ipp://, ipps://, AirPrint / dnssd)  Get-Printer-Attributes to
 *       the device: reachable, plus its own state, alerts and ink levels.
 *   Raw / LPD printers (socket://, lpd://)  a TCP connect to the port.
 *   USB printers on macOS  the CUPS usb backend's device list: plugged in and
 *       switched on, or not.
 *
 * Anything else (SMB shares, virtual PDF printers) is "can't tell" — null.
 */

export interface DeviceProbe {
  reachable: boolean | null
  /** The device's own printer-state / reasons, when it speaks IPP. */
  ippState?: number
  reasons: string[]
  supplies: PrinterSupply[]
}

const UNKNOWN: DeviceProbe = { reachable: null, reasons: [], supplies: [] }
const PROBE_TIMEOUT_MS = 2_500

export const connectionFromUri = (uri: string | undefined): PrinterConnection => {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(uri ?? '')?.[1]?.toLowerCase()
  if (!scheme) return 'unknown'
  if (['usb', 'ippusb', 'riousbprint', 'serial', 'parallel'].includes(scheme)) return 'usb'
  if (['dnssd', 'mdns', 'ipp', 'ipps', 'http', 'https', 'socket', 'lpd', 'smb', 'wsd'].includes(scheme)) return 'network'
  return 'virtual'
}

/** TCP connect: does anything answer on host:port? */
export const tcpProbe = (host: string, port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> =>
  new Promise(resolve => {
    const socket = connect({ host, port })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })

/** Ask an IPP printer directly for its state. */
export const ippProbe = async (uri: string): Promise<DeviceProbe> => {
  const url = new URL(uri.replace(/^http(s?):/i, 'ipp$1:'))
  const path = url.pathname || '/ipp/print'
  try {
    const response = await ippRequest(
      { url: url.toString() },
      path,
      IPP_OP.getPrinterAttributes,
      [
        ...baseAttributes('printer-uri', url.toString()),
        requested('printer-state', 'printer-state-reasons', 'marker-names', 'marker-levels', 'marker-colors')
      ],
      PROBE_TIMEOUT_MS
    )
    const printer = response.groups.find(group => group.tag === 0x04)?.attributes
    if (!isIppSuccess(response) || !printer) return { ...UNKNOWN, reachable: true }
    const reasons = strs(printer, 'printer-state-reasons')
    const ippState = num(printer, 'printer-state')
    return {
      reachable: true,
      ...(ippState !== undefined ? { ippState } : {}),
      reasons,
      supplies: parseSupplies(strs(printer, 'marker-names'), nums(printer, 'marker-levels'), strs(printer, 'marker-colors'))
    }
  } catch (error) {
    // An HTTP-level answer (e.g. 426 "use TLS") still proves the device is on.
    const answered = error instanceof Error && /answered HTTP/.test(error.message)
    return { ...UNKNOWN, reachable: answered }
  }
}

/**
 * A dnssd:// device URI names a Bonjour service, not a host:
 *   dnssd://EPSON%20L3250%20Series._ipp._tcp.local./?uuid=…
 * ippfind looks it up on the network and prints where it lives right now
 * (ipp://EPSON1A2B3C.local:631/ipp/print). A printer that is off or on another
 * network is simply not found.
 */
export const parseDnssd = (uri: string): { name: string; type: string } | null => {
  const host = /^(?:dnssd|mdns):\/\/([^/?]+)/i.exec(uri)?.[1]
  if (!host) return null
  const decoded = decodeURIComponent(host)
  const match = /^(.*)\.(_[a-z0-9-]+\._tcp)\.(?:local\.?)?$/i.exec(decoded)
  return match?.[1] && match[2] ? { name: match[1], type: match[2] } : null
}

const IPPFIND = process.platform === 'darwin' ? '/usr/bin/ippfind' : 'ippfind'
const resolved = new Map<string, { uri: string; at: number }>()
const RESOLVE_TTL_MS = 5 * 60_000

const resolveDnssd = async (uri: string, fresh: boolean): Promise<string | null> => {
  const cached = resolved.get(uri)
  if (!fresh && cached && Date.now() - cached.at < RESOLVE_TTL_MS) return cached.uri
  const service = parseDnssd(uri)
  if (!service) return null
  try {
    const { stdout } = await run(IPPFIND, ['-T', '2', `${service.type}.local.`, '-N', service.name, '--print'], {
      timeout: 6_000
    })
    const found = stdout.split('\n').map(line => line.trim()).find(Boolean)
    if (!found) {
      resolved.delete(uri)
      return null
    }
    resolved.set(uri, { uri: found, at: Date.now() })
    return found
  } catch {
    // Exit 1 is "nothing found"; a missing ippfind (some Linux) lands here too.
    resolved.delete(uri)
    return null
  }
}

const hostPortProbe = async (uri: string, defaultPort: number): Promise<DeviceProbe> => {
  const url = new URL(uri)
  if (!url.hostname) return UNKNOWN
  return { ...UNKNOWN, reachable: await tcpProbe(url.hostname, Number(url.port) || defaultPort) }
}

/** Probe a CUPS device URI. */
export const probeDeviceUri = async (uri: string, usbDevices: Set<string> | null): Promise<DeviceProbe> => {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(uri)?.[1]?.toLowerCase()
  try {
    switch (scheme) {
      case 'ipp':
      case 'ipps':
      case 'http':
      case 'https':
        return await ippProbe(uri)
      case 'socket':
        return await hostPortProbe(uri, 9100)
      case 'lpd':
        return await hostPortProbe(uri, 515)
      case 'dnssd':
      case 'mdns': {
        let target = await resolveDnssd(uri, false)
        if (!target) return { ...UNKNOWN, reachable: false }
        let result = await probeResolved(target)
        // The printer may have moved to a new address since it was looked up.
        if (result.reachable === false) {
          target = await resolveDnssd(uri, true)
          if (!target) return { ...UNKNOWN, reachable: false }
          result = await probeResolved(target)
        }
        return result
      }
      case 'usb':
        return usbDevices ? { ...UNKNOWN, reachable: isUsbAttached(uri, usbDevices) } : UNKNOWN
      default:
        return UNKNOWN
    }
  } catch {
    return UNKNOWN
  }
}

const probeResolved = (target: string): Promise<DeviceProbe> => {
  if (/^socket:/i.test(target)) return hostPortProbe(target, 9100)
  if (/^lpd:/i.test(target)) return hostPortProbe(target, 515)
  return ippProbe(target)
}

/** usb://EPSON/L3250%20Series?serial=X — matched with or without the serial. */
const isUsbAttached = (uri: string, devices: Set<string>): boolean => {
  if (devices.has(uri)) return true
  const base = uri.split('?')[0]
  return [...devices].some(device => device.split('?')[0] === base)
}

const USB_BACKEND = process.platform === 'darwin' ? '/usr/libexec/cups/backend/usb' : '/usr/lib/cups/backend/usb'

/**
 * The USB printers plugged in and switched on right now, as CUPS device URIs.
 * A CUPS backend run with no arguments lists the devices it can see:
 *   direct usb://EPSON/L3250%20Series?serial=X "EPSON L3250 Series" …
 * Null when the backend cannot be run (on Linux it is usually root-only).
 */
export const listUsbDevices = async (): Promise<Set<string> | null> => {
  try {
    await access(USB_BACKEND, constants.X_OK)
    const { stdout } = await run(USB_BACKEND, [], { timeout: 5_000 })
    return new Set(
      stdout
        .split('\n')
        .map(line => /^\S+\s+(usb:\/\/\S+)/.exec(line)?.[1])
        .filter((uri): uri is string => Boolean(uri))
    )
  } catch {
    return null
  }
}
