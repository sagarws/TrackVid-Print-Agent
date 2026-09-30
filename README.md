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

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/v1/status` | — | `{ ok, app, version, allowed }`, answers any browser origin |
| GET | `/v1/printers` | — | `{ ok, printers: [{ name, displayName }] }` |
| POST | `/v1/print` | `{ printer, pdfBase64, jobName? }` | `{ ok, jobId }` once the OS queue accepted the job |

Every request except `/v1/status` must come from an origin on the agent's
**Allowed websites** list (default `https://trackvid.in`, `https://*.trackvid.in`;
`localhost:3000/8002` are added in a dev run only). Host must be
`127.0.0.1:17865` or `localhost:17865` (DNS-rebinding guard). The port and paths
are mirrored in TrackVid-FE `src/config/constant.ts` (`PRINT_AGENT_*`).

## How it prints

- **macOS:** `lp -d <printer> -o fit-to-page` (CUPS).
- **Windows:** SumatraPDF via `pdf-to-printer`, `scale: fit`.
- Jobs run one at a time, in arrival order. "Sent" means the OS print queue
  accepted the job, not that paper came out (same guarantee QZ Tray gave).

## Not done yet

- Code signing / notarization (unsigned builds warn on first launch).
- Auto-update.
- Real `.icns` / `.ico` icons (build/icon.png is the CMS icon).
