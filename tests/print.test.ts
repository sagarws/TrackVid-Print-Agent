import { describe, expect, it } from 'vitest'
import { lpArgs, parseLpJobId } from '@main/print/cups'
import { connectionFromUri, parseDnssd } from '@main/print/probe'
import { sumatraOptions, windowsJobState, windowsSnapshot } from '@main/print/windows'

describe('lpArgs', () => {
  it('prints a PDF fitted to the page by default', () => {
    expect(lpArgs('/tmp/a.pdf', 'Epson', 'Label', 'pdf')).toEqual(['-d', 'Epson', '-t', 'Label', '-o', 'fit-to-page', '--', '/tmp/a.pdf'])
  })

  it('maps every option', () => {
    const args = lpArgs('/tmp/a.pdf', 'Epson', 'Invoice', 'pdf', {
      copies: 2,
      pages: '1-2',
      orientation: 'landscape',
      paperSize: 'iso_a4_210x297mm',
      scale: 'none',
      duplex: 'long-edge',
      color: false
    })
    expect(args).toEqual([
      '-d', 'Epson', '-t', 'Invoice', '-n', '2',
      '-o', 'print-scaling=none', '-P', '1-2', '-o', 'landscape', '-o', 'media=iso_a4_210x297mm',
      '-o', 'sides=two-sided-long-edge', '-o', 'print-color-mode=monochrome',
      '--', '/tmp/a.pdf'
    ])
  })

  it('sends raw jobs untouched, ignoring page options', () => {
    expect(lpArgs('/tmp/a.prn', 'Zebra', 'Label', 'raw', { copies: 3, orientation: 'landscape' })).toEqual([
      '-d', 'Zebra', '-t', 'Label', '-n', '3', '-o', 'raw', '--', '/tmp/a.prn'
    ])
  })
})

describe('parseLpJobId', () => {
  it('reads the CUPS job number', () => {
    expect(parseLpJobId('request id is Epson_L3250-32 (1 file(s))\n')).toBe('32')
    expect(parseLpJobId('request id is My-Printer-2-7 (1 file(s))')).toBe('7')
    expect(parseLpJobId('')).toBeUndefined()
  })
})

describe('device URIs', () => {
  it('tells network from USB from virtual', () => {
    expect(connectionFromUri('dnssd://EPSON%20L3250._ipp._tcp.local./?uuid=1')).toBe('network')
    expect(connectionFromUri('socket://10.0.0.5:9100')).toBe('network')
    expect(connectionFromUri('usb://Zebra/ZD420?serial=1')).toBe('usb')
    expect(connectionFromUri('cups-pdf:/')).toBe('virtual')
    expect(connectionFromUri(undefined)).toBe('unknown')
  })

  it('reads the Bonjour service out of a dnssd URI', () => {
    expect(parseDnssd('dnssd://EPSON%20L3250%20Series._ipp._tcp.local./?uuid=cfe9')).toEqual({
      name: 'EPSON L3250 Series',
      type: '_ipp._tcp'
    })
    expect(parseDnssd('dnssd://Zebra%20ZD420._pdl-datastream._tcp.local./')).toEqual({
      name: 'Zebra ZD420',
      type: '_pdl-datastream._tcp'
    })
    expect(parseDnssd('ipp://host/ipp/print')).toBeNull()
  })
})

describe('Windows', () => {
  const printer = {
    name: 'Zebra ZD420',
    driver: 'ZDesigner ZD420-203dpi ZPL',
    location: null,
    portName: 'IP_192.168.1.40',
    host: '192.168.1.40',
    portNumber: 9100,
    protocol: 1,
    status: 'Normal',
    workOffline: false,
    type: 'Local',
    isDefault: true,
    jobs: { id: 4, name: 'trackvid-ab12.pdf', status: 'Paused', user: 'packer', submitted: null }
  }

  it('maps spooler job flags', () => {
    expect(windowsJobState('Printing, Retained')).toBe('printing')
    expect(windowsJobState('Paused')).toBe('held')
    expect(windowsJobState('Error, Offline')).toBe('stopped')
    expect(windowsJobState('Deleting')).toBe('cancelled')
    expect(windowsJobState('')).toBe('pending')
  })

  it('builds a snapshot, with a single job not wrapped in an array', () => {
    const snapshot = windowsSnapshot(printer, true)
    expect(snapshot).toMatchObject({ name: 'Zebra ZD420', isDefault: true, connection: 'network' })
    expect(snapshot.status.state).toBe('ready')
    expect(snapshot.queue).toEqual([{ id: '4', name: 'trackvid-ab12.pdf', state: 'held', reasons: ['Paused'], user: 'packer' }])
  })

  it('is offline when the port does not answer or Windows says so', () => {
    expect(windowsSnapshot(printer, false).status.state).toBe('offline')
    expect(windowsSnapshot({ ...printer, status: 'Offline' }, null).status.state).toBe('offline')
    expect(windowsSnapshot({ ...printer, status: 'Paused' }, true).status.state).toBe('paused')
    expect(windowsSnapshot({ ...printer, status: 'PaperOut' }, true).status.message).toBe('Out of paper')
  })

  it('maps print options to SumatraPDF', () => {
    expect(sumatraOptions('Zebra', { copies: 2, scale: 'none', duplex: 'short-edge', color: false })).toEqual({
      printer: 'Zebra',
      silent: true,
      scale: 'noscale',
      copies: 2,
      side: 'duplexshort',
      monochrome: true
    })
  })
})
