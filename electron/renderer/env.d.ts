/// <reference types="vite/client" />

import type { PrintAgentApi } from '../preload/preload'

declare global {
  interface ImportMetaEnv {
    /** TrackVid-BE base URL (no /api), the web admin's backend. Inlined at build time. */
    readonly VITE_APP_BASE_URL?: string
  }

  interface Window {
    /** The preload bridge — see electron/preload/preload.ts. */
    printAgent: PrintAgentApi
  }
}
