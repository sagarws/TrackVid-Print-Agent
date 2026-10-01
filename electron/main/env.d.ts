/** Build-time env electron-vite inlines into the main process (VITE_* is shared with the window). */
interface ImportMetaEnv {
  /** TrackVid-BE base URL (no /api). Allowed in the window's Content-Security-Policy. */
  readonly VITE_APP_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
