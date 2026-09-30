/// <reference types="vite/client" />

import type { PrintAgentApi } from '../preload/preload'

declare global {
  interface Window {
    /** The preload bridge — see electron/preload/preload.ts. */
    printAgent: PrintAgentApi
  }
}
