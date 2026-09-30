# TrackVid Print Agent

A small desktop app (Electron) that runs on each packing computer and lets the
TrackVid web app print label / invoice PDFs **silently to a named printer**.
It replaces QZ Tray: no certificate, no "Allow" popup.

Setup and theme are taken from Trackvid-CMS (electron-vite, MUI 7 + the ported
Monitor/Vercel theme, Tailwind 4, the same pinned versions).

## Run

```bash
npm install
npm run dev          # agent window + local API on http://127.0.0.1:17865
npm run verify       # typecheck ×2 + lint + tests
npm run build:mac    # dmg (x64 + arm64)
npm run build:win    # NSIS installer (x64)
```

## API (loopback only)

`GET /v1/status` → `{ ok, app, version, allowed, apiVersion: 2 }` answers any browser origin.
Everything else needs an origin on the **Allowed websites** list.

| Method | Path | Returns |
|---|---|---|
| GET | `/v1/printers[?refresh=1]` | `{ ok, printers: [printer] }` |
| GET | `/v1/printers/:name[?refresh=1]` | `{ ok, printer }` |
| POST | `/v1/print` | `{ ok, jobId, job, printer }` once the OS queue took it. **409** + `printer` when it is offline / paused, **502** when the OS refused it |
| GET | `/v1/jobs` | `{ ok, jobs }`: this website's jobs from this session |
| GET | `/v1/jobs/:id` | `{ ok, job }` |
| POST | `/v1/jobs/:id/cancel` | `{ ok, job }` |
| GET | `/v1/events` | Server-Sent Events: `printers` (full list on every status change), `job` (each change to this website's jobs) |

**printer** = `{ name, displayName, isDefault, connection: network|usb|virtual|unknown, driver?, location?,
status: { state: ready|printing|paused|offline|error|unknown, message, issues: [{ code, severity, message }],
reachable, acceptingJobs, checkedAt }, supplies: [{ name, level: 0-100|null, color? }], queuedJobs }`

**job.status**: `sending → queued → printing → done`, or `held`, `failed`, `cancelled`.
`done` means the OS finished handing the job to the printer, not only that the queue took it.

**POST /v1/print** body (the original `{ printer, pdfBase64, jobName? }` still works):

```jsonc
{
  "printer": "Epson_L3250",
  "format": "pdf",              // or "raw": ZPL / EPL / ESC-POS sent to the printer untouched
  "data": "<base64>",           // or, for raw, "text": "^XA...^XZ"
  "jobName": "Label 1234",
  "options": {                  // all optional
    "copies": 2, "pages": "1-2", "orientation": "landscape", "paperSize": "4x6",
    "scale": "fit" | "shrink" | "none", "duplex": "one-sided" | "long-edge" | "short-edge", "color": false
  },
  "allowOffline": false         // true: queue even if the printer is offline/paused
}
```

Host must be `127.0.0.1:17865` or `localhost:17865` (DNS-rebinding guard). The port and paths
are mirrored in TrackVid-FE `src/config/constant.ts` (`PRINT_AGENT_*`).

## How it works

- **Printer status** is re-read every 10 s. The OS queue (paused? accepting? its jobs) comes from
  CUPS over its local socket (macOS/Linux) or the spooler via PowerShell (Windows). Then each
  **device is checked directly**:
  IPP/AirPrint printers get an IPP Get-Printer-Attributes (state, alerts, ink levels; Bonjour
  `dnssd://` names are resolved with `ippfind`), raw/LPD printers a TCP connect, and USB printers on
  macOS are looked up in the CUPS usb backend's device list. A Wi-Fi printer that is switched off
  shows as **Offline** within one poll, not after jobs pile up behind it.
- **Printing:** macOS `lp` (`-o fit-to-page` by default, `-o raw` for raw), Windows SumatraPDF via
  `pdf-to-printer` for PDFs and `WritePrinter` (datatype RAW) for raw. Jobs are handed over one at
  a time, in arrival order, then followed in the OS queue until they finish.
- **Offline / paused printers are refused** by default (Settings → Printing), so TrackVid shows
  the problem at once instead of the job printing hours later. `allowOffline: true` overrides it
  per job.
- **Managing the queue** from the window: Resume a paused printer, Release or Cancel held jobs
  (including other apps'), Clear the queue, Reprint recent jobs. Desktop notifications when a
  printer in use goes offline, runs out of paper, or a job fails.

## Not done yet

- Code signing / notarization (unsigned builds warn on first launch).
- Auto-update.
- The Windows status / queue / raw-printing code (PowerShell) is unit-tested but not yet run on a Windows machine.
- Real `.icns` / `.ico` icons (build/icon.png is the CMS icon).
