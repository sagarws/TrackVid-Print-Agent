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
Everything else needs an allowed origin. The list is built in, not editable: `https://trackvid.in`,
`https://*.trackvid.in`, and `http://localhost` / `http://127.0.0.1` on **any port**
(`ALLOWED_ORIGINS` in `shared/constants/agent.ts`).

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
  "printer": "Label_Printer",   // a `name` from GET /v1/printers
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

## Scan & Pack (in the app)

The web admin's Scan & Pack flow, ported into the app under **Scan and Pack** in the sidebar:
packlog list → upload (order sheet + label/invoice PDFs, scanned and matched by Forward AWB)
→ packlog detail (preview, bulk update, reprint) → pack screen (scan an AWB, it prints and is
marked packed).

- **Screens** are TrackVid-FE's files in `electron/renderer/scanpack/`, kept close to the
  originals (lint exemptions in `eslint.config.mjs`). Agent-only changes are marked
  `AGENT CHANGE`: the label preview draws with pdf.js instead of the browser PDF viewer,
  and printing goes straight onto the agent's own queue (no browser-dialog fallback; an
  unassigned printer is an error).
- **No backend, no Google Drive.** `electron/main/scanpack/` stands in for TrackVid-BE's
  `/packlog` API over IPC: records in `<userData>/scanpack/<id>.json`, PDFs in
  `<chosen folder>/scan-and-pack/<YYYY-MM-DD_to_YYYY-MM-DD>/<packlogId>-<part>-<awb>.pdf`,
  the same week folders (Monday–Sunday, IST) and file names the backend uses on Drive.
  Packlogs made here do not appear in the web admin, and the other way round.
- **Settings → Scan & Pack storage:** the folder (default: Downloads), how many weeks to
  keep (default 2 = this week + last week, as on the backend), and Clean up now.
- **Retention** runs at startup and every 6 hours: packlogs from expired weeks are deleted
  with their PDFs; an expired week folder is removed once it is empty. Only files named like
  a packlog PDF are ever deleted, so anything else saved in those folders survives.



- Code signing / notarization (unsigned builds warn on first launch).
- Auto-update.
- The Windows status / queue / raw-printing code (PowerShell) is unit-tested but not yet run on a Windows machine.
- Real `.icns` / `.ico` icons (build/icon.png is the CMS icon).
