import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { print as sumatraPrint, type PrintOptions as SumatraOptions } from 'pdf-to-printer'
import type { PrintFormat, PrintOptions, QueueJob, QueueJobState } from '@shared/types/agent'
import type { OsJob, PrintBackend, PrinterSnapshot } from './backend'
import { tcpProbe } from './probe'
import { deriveStatus } from './status'

const run = promisify(execFile)

/**
 * Windows: the print spooler, asked through PowerShell's PrintManagement
 * cmdlets (Get-Printer, Get-PrintJob, …), which every supported Windows has.
 *
 * Values reach PowerShell through environment variables, never through the
 * script text, so a printer called `'; Remove-Item …` is just a name.
 */
const powershell = async (script: string, env: Record<string, string> = {}, timeout = 20_000): Promise<string> => {
  const prelude = "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; [Console]::OutputEncoding = [Text.Encoding]::UTF8;"
  const encoded = Buffer.from(`${prelude}\n${script}`, 'utf16le').toString('base64')
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout, windowsHide: true, env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 }
  )
  return stdout
}

const LIST_SCRIPT = `
$ports = @{}
Get-PrinterPort | ForEach-Object { $ports[$_.Name] = $_ }
$default = (Get-CimInstance -ClassName Win32_Printer -Filter 'Default=TRUE' | Select-Object -First 1).Name
$out = @(Get-Printer | ForEach-Object {
  $p = $_
  $port = $ports[$p.PortName]
  $jobs = @(Get-PrintJob -PrinterName $p.Name -ErrorAction SilentlyContinue | ForEach-Object {
    [pscustomobject]@{ id = $_.Id; name = $_.DocumentName; status = [string]$_.JobStatus; user = $_.UserName; submitted = if ($_.SubmittedTime) { $_.SubmittedTime.ToString('o') } else { $null } }
  })
  [pscustomobject]@{
    name = $p.Name; driver = $p.DriverName; location = $p.Location; portName = $p.PortName
    host = if ($port) { $port.PrinterHostAddress } else { $null }
    portNumber = if ($port) { $port.PortNumber } else { $null }
    protocol = if ($port) { $port.Protocol } else { $null }
    status = [string]$p.PrinterStatus; workOffline = [bool]$p.WorkOffline; type = [string]$p.Type
    isDefault = ($p.Name -eq $default); jobs = $jobs
  }
})
ConvertTo-Json -Depth 5 -Compress -InputObject $out
`

interface WinJob {
  id: number
  name: string | null
  status: string | null
  user: string | null
  submitted: string | null
}

interface WinPrinter {
  name: string
  driver: string | null
  location: string | null
  portName: string | null
  host: string | null
  portNumber: number | null
  protocol: number | null
  status: string | null
  workOffline: boolean
  type: string | null
  isDefault: boolean
  jobs: WinJob[] | WinJob | null
}

/** Spooler PrinterStatus names → IPP reason keywords, so status.ts words them once. */
const WINDOWS_REASONS: Record<string, string> = {
  Paused: 'paused',
  Error: 'other-error',
  PaperJam: 'media-jam-error',
  PaperOut: 'media-empty-error',
  ManualFeed: 'media-needed-warning',
  PaperProblem: 'media-needed-error',
  Offline: 'offline-report',
  OutputBinFull: 'output-area-full-error',
  NotAvailable: 'offline-report',
  TonerLow: 'toner-low-warning',
  NoToner: 'toner-empty-error',
  UserIntervention: 'user-intervention-required-error',
  OutOfMemory: 'spool-area-full-error',
  DoorOpen: 'door-open-error',
  ServerUnknown: 'offline-report',
  PendingDeletion: 'shutdown-report'
}

/** "Paused, Offline" / "Normal" → flags. */
const flags = (value: string | null | undefined): string[] =>
  (value ?? '').split(',').map(flag => flag.trim()).filter(Boolean)

export const windowsJobState = (status: string | null | undefined): QueueJobState => {
  const set = new Set(flags(status))
  if (set.has('Deleting') || set.has('Deleted')) return 'cancelled'
  if (set.has('Printed') || set.has('Complete')) return 'completed'
  if (set.has('Error') || set.has('Offline') || set.has('PaperOut') || set.has('Blocked') || set.has('UserIntervention')) {
    return 'stopped'
  }
  if (set.has('Paused')) return 'held'
  if (set.has('Printing') || set.has('Spooling')) return 'printing'
  return 'pending'
}

const toQueueJob = (job: WinJob): QueueJob => ({
  id: String(job.id),
  name: job.name || 'Untitled',
  state: windowsJobState(job.status),
  reasons: flags(job.status).filter(flag => flag !== 'Normal'),
  ...(job.user ? { user: job.user } : {}),
  ...(job.submitted ? { createdAt: job.submitted } : {})
})

/**
 * Where a Windows port leads. A Standard TCP/IP port has an address to probe
 * (port 9100 raw or 515 LPR); an IPP port's name is its URL. WSD, USB and
 * local ports have nothing to probe — the spooler's own status stands.
 */
const probeTarget = (printer: WinPrinter): { host: string; port: number } | null => {
  if (printer.host) return { host: printer.host, port: printer.portNumber || (printer.protocol === 2 ? 515 : 9100) }
  const url = /^(https?|ipps?):\/\/[^\s]+/i.exec(printer.portName ?? '')?.[0]
  if (!url) return null
  try {
    const parsed = new URL(url.replace(/^ipp(s?):/i, 'http$1:'))
    return { host: parsed.hostname, port: Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 631) }
  } catch {
    return null
  }
}

const connectionOf = (printer: WinPrinter): PrinterSnapshot['connection'] => {
  const port = printer.portName ?? ''
  if (/^USB\d+|^DOT4/i.test(port)) return 'usb'
  if (printer.host || /^(WSD-|IP_|https?:|ipps?:|\\\\)/i.test(port) || printer.type === 'Connection') return 'network'
  if (/^(PORTPROMPT:|FILE:|nul:|SHRFAX:)/i.test(port) || /PDF|XPS|OneNote|Fax/i.test(printer.name)) return 'virtual'
  return 'unknown'
}

export const windowsSnapshot = (printer: WinPrinter, reachable: boolean | null): PrinterSnapshot => {
  const statusFlags = flags(printer.status)
  const reasons = statusFlags.map(flag => WINDOWS_REASONS[flag]).filter((reason): reason is string => Boolean(reason))
  if (printer.workOffline) reasons.push('offline-report')
  const busy = statusFlags.some(flag => ['Printing', 'Processing', 'Busy', 'IOActive', 'WarmingUp', 'Initializing'].includes(flag))
  const jobs = printer.jobs ? (Array.isArray(printer.jobs) ? printer.jobs : [printer.jobs]) : []

  return {
    name: printer.name,
    displayName: printer.name,
    isDefault: printer.isDefault,
    connection: connectionOf(printer),
    ...(printer.driver ? { driver: printer.driver } : {}),
    ...(printer.location ? { location: printer.location } : {}),
    ...(printer.portName ? { address: printer.host ? `${printer.portName} (${printer.host})` : printer.portName } : {}),
    status: deriveStatus({
      ippState: busy ? 4 : 3,
      reasons: reasons.filter(reason => reason !== 'paused'),
      acceptingJobs: true,
      reachable,
      paused: statusFlags.includes('Paused')
    }),
    supplies: [],
    queue: jobs.map(toQueueJob)
  }
}

const listPrinters = async (): Promise<PrinterSnapshot[]> => {
  const raw = (await powershell(LIST_SCRIPT)).trim()
  const parsed = raw ? (JSON.parse(raw) as WinPrinter[] | WinPrinter) : []
  const printers = Array.isArray(parsed) ? parsed : [parsed]
  return Promise.all(
    printers.map(async printer => {
      const target = probeTarget(printer)
      const reachable = target ? await tcpProbe(target.host, target.port) : null
      return windowsSnapshot(printer, reachable)
    })
  )
}

const getJob = async (printer: string, osJobId: string): Promise<OsJob | null> => {
  const out = (
    await powershell(
      `$j = Get-PrintJob -PrinterName $env:TV_PRINTER -ID ([int]$env:TV_JOB) -ErrorAction SilentlyContinue
if ($j) { [string]$j.JobStatus } else { '<gone>' }`,
      { TV_PRINTER: printer, TV_JOB: osJobId }
    )
  ).trim()
  if (out === '<gone>') return null
  return { state: windowsJobState(out), reasons: flags(out).filter(flag => flag !== 'Normal') }
}

/** The spooler job SumatraPDF just created, found by the file's unique name. */
const findJobByDocument = async (printer: string, marker: string): Promise<string | undefined> => {
  const out = (
    await powershell(
      `$j = Get-PrintJob -PrinterName $env:TV_PRINTER -ErrorAction SilentlyContinue | Where-Object { $_.DocumentName -like "*$($env:TV_MARKER)*" } | Select-Object -First 1
if ($j) { $j.Id }`,
      { TV_PRINTER: printer, TV_MARKER: marker }
    )
  ).trim()
  return /^\d+$/.test(out) ? out : undefined
}

/**
 * Windows: print through the SumatraPDF.exe that pdf-to-printer bundles.
 *
 * In a packaged app that exe is inside app.asar, where Windows cannot execute
 * it; electron-builder.yml unpacks it next to the archive and this points at
 * the unpacked copy explicitly. pdf-to-printer tries the same rewrite itself,
 * but only via `process.mainModule`, which Electron's main process does not
 * reliably set.
 */
const sumatraPath = (() => {
  let cached: string | null = null
  return (): string => {
    if (cached) return cached
    const dir = dirname(require.resolve('pdf-to-printer')).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    const exe = readdirSync(dir).find(name => /^SumatraPDF.*\.exe$/i.test(name))
    if (!exe) throw new Error(`SumatraPDF.exe is missing from ${dir}. Reinstall the TrackVid Print Agent.`)
    cached = join(dir, exe)
    return cached
  }
})()

/** Print options → SumatraPDF's. Exported for the tests. */
export const sumatraOptions = (printer: string, options: PrintOptions = {}): SumatraOptions => {
  const scale = options.scale ?? 'fit'
  const sides = { 'one-sided': 'simplex', 'long-edge': 'duplexlong', 'short-edge': 'duplexshort' } as const
  return {
    printer,
    silent: true,
    // `fit` matches QZ Tray's default, as on macOS.
    scale: scale === 'none' ? 'noscale' : scale,
    ...(options.copies && options.copies > 1 ? { copies: options.copies } : {}),
    ...(options.pages ? { pages: options.pages } : {}),
    ...(options.orientation ? { orientation: options.orientation } : {}),
    ...(options.paperSize ? { paperSize: options.paperSize } : {}),
    ...(options.duplex ? { side: sides[options.duplex] } : {}),
    ...(options.color === false ? { monochrome: true } : {})
  }
}

/**
 * Raw printing: the bytes go to the spooler as-is (datatype RAW), which is how
 * ZPL / EPL / ESC-POS reach a thermal printer untouched — what QZ Tray's raw
 * mode does. StartDocPrinter hands back the spooler job id.
 */
const RAW_SCRIPT = `
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class TrackVidRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinter(IntPtr handle, int level, [In] DocInfo info);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
  public static int Send(string printer, string title, byte[] data, int copies) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      int job = StartDocPrinter(handle, 1, new DocInfo { pDocName = title, pDataType = "RAW" });
      if (job == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        for (int i = 0; i < copies; i++) {
          if (!StartPagePrinter(handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
          int written;
          if (!WritePrinter(handle, data, data.Length, out written) || written != data.Length) throw new Win32Exception(Marshal.GetLastWin32Error());
          EndPagePrinter(handle);
        }
      } finally { EndDocPrinter(handle); }
      return job;
    } finally { ClosePrinter(handle); }
  }
}
'@
[TrackVidRawPrint]::Send($env:TV_PRINTER, $env:TV_TITLE, [IO.File]::ReadAllBytes($env:TV_FILE), [int]$env:TV_COPIES)
`

const print = async (
  file: string,
  printer: string,
  title: string,
  format: PrintFormat,
  options?: PrintOptions
): Promise<{ osJobId?: string }> => {
  if (format === 'raw') {
    const out = (
      await powershell(RAW_SCRIPT, {
        TV_PRINTER: printer,
        TV_TITLE: title,
        TV_FILE: file,
        TV_COPIES: String(options?.copies ?? 1)
      }, 60_000)
    ).trim()
    return /^\d+$/.test(out) ? { osJobId: out } : {}
  }
  // Resolves once SumatraPDF has spooled the job and exited.
  await sumatraPrint(file, { ...sumatraOptions(printer, options), sumatraPdfPath: sumatraPath() })
  const marker = /trackvid-[0-9a-f]+/i.exec(file)?.[0]
  const osJobId = marker ? await findJobByDocument(printer, marker).catch(() => undefined) : undefined
  return osJobId ? { osJobId } : {}
}

const jobCommand = (command: string) => async (printer: string, osJobId: string) => {
  await powershell(`${command} -PrinterName $env:TV_PRINTER -ID ([int]$env:TV_JOB)`, { TV_PRINTER: printer, TV_JOB: osJobId })
}

export const windowsBackend: PrintBackend = {
  listPrinters,
  getJob,
  print,
  cancelJob: jobCommand('Remove-PrintJob'),
  releaseJob: jobCommand('Resume-PrintJob'),
  clearQueue: async printer => {
    await powershell('Get-PrintJob -PrinterName $env:TV_PRINTER | Remove-PrintJob', { TV_PRINTER: printer })
  },
  resumePrinter: async printer => {
    await powershell(
      `$p = Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Name -eq $env:TV_PRINTER } | Select-Object -First 1
if (-not $p) { throw 'Printer not found.' }
$r = Invoke-CimMethod -InputObject $p -MethodName Resume
if ($r.ReturnValue -ne 0) { throw "Windows could not resume the printer (code $($r.ReturnValue)). Try as an administrator." }
# "Use Printer Offline" is a separate switch from Pause; clear it too.
if ($p.WorkOffline) { Set-CimInstance -InputObject $p -Property @{ WorkOffline = $false } -ErrorAction SilentlyContinue }`,
      { TV_PRINTER: printer }
    )
  }
}
