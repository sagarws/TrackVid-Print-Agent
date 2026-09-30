import { describe, expect, it } from 'vitest'
import { blocksPrinting, describeReason, deriveStatus, ippJobState, parseSupplies } from '@main/print/status'

describe('describeReason', () => {
  it('words known reasons and keeps severity from the suffix', () => {
    expect(describeReason('media-empty-error')).toMatchObject({ severity: 'error', message: 'Out of paper' })
    expect(describeReason('toner-low-warning')).toMatchObject({ severity: 'warning', message: 'Toner is low' })
    expect(describeReason('media-low-report')).toMatchObject({ severity: 'info' })
  })

  it('treats paused and offline as errors whatever the suffix', () => {
    expect(describeReason('paused')?.severity).toBe('error')
    expect(describeReason('offline-report')?.severity).toBe('error')
  })

  it('ignores bookkeeping reasons and words unknown ones readably', () => {
    expect(describeReason('none')).toBeNull()
    expect(describeReason('cups-waiting-for-job-completed')).toBeNull()
    expect(describeReason('com.epson.ink-cartridge-warning')?.message).toBe('Ink cartridge')
  })
})

describe('deriveStatus', () => {
  const base = { reasons: [], acceptingJobs: true, reachable: true, paused: false }

  it('is ready when the device answers idle', () => {
    expect(deriveStatus({ ...base, ippState: 3 })).toMatchObject({ state: 'ready', message: 'Ready' })
  })

  it('is offline when the device does not answer, even if the queue is paused', () => {
    const status = deriveStatus({ ...base, reachable: false, paused: true, ippState: 5 })
    expect(status.state).toBe('offline')
    expect(status.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['printer-not-reachable', 'paused']))
    expect(blocksPrinting(status)).toBe(true)
  })

  it('is paused when the queue is paused and the device is there', () => {
    const status = deriveStatus({ ...base, paused: true, ippState: 5 })
    expect(status.state).toBe('paused')
    expect(blocksPrinting(status)).toBe(true)
  })

  it('reports device errors, and does not block printing for them', () => {
    const status = deriveStatus({ ...base, ippState: 5, reasons: ['media-empty-error'] })
    expect(status).toMatchObject({ state: 'error', message: 'Out of paper' })
    expect(blocksPrinting(status)).toBe(false)
  })

  it('does not call a low-ink warning an error', () => {
    expect(deriveStatus({ ...base, ippState: 3, reasons: ['marker-supply-low-warning'] }).state).toBe('ready')
  })

  it('is unknown when nothing can be checked', () => {
    expect(deriveStatus({ ...base, reachable: null }).state).toBe('unknown')
  })

  it('treats a queue that rejects jobs as paused', () => {
    expect(deriveStatus({ ...base, ippState: 3, acceptingJobs: false })).toMatchObject({
      state: 'paused',
      message: 'Not accepting jobs'
    })
  })
})

describe('parseSupplies', () => {
  it('maps levels and colours, with unknown levels as null', () => {
    expect(parseSupplies(['Black', 'Cyan'], [55, -3], ['#000000', '#00FFFF#FF00FF'])).toEqual([
      { name: 'Black', level: 55, color: '#000000' },
      { name: 'Cyan', level: null, color: '#00FFFF' }
    ])
  })
})

describe('ippJobState', () => {
  it('maps IPP job states', () => {
    expect(ippJobState(3)).toBe('pending')
    expect(ippJobState(4)).toBe('held')
    expect(ippJobState(9)).toBe('completed')
    expect(ippJobState(undefined, ['job-hold-until-specified'])).toBe('held')
  })
})
