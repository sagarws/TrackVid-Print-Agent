/** IPC channel names between the window and the main process. */
export const IPC = {
  getState: 'agent:get-state',
  state: 'agent:state',
  refreshPrinters: 'agent:refresh-printers',
  testPrint: 'agent:test-print',
  setOpenAtLogin: 'agent:set-open-at-login',
  setThemeMode: 'agent:set-theme-mode',
  setBlockOfflinePrinters: 'agent:set-block-offline-printers',
  setNotifications: 'agent:set-notifications',
  resumePrinter: 'agent:resume-printer',
  clearQueue: 'agent:clear-queue',
  cancelQueueJob: 'agent:cancel-queue-job',
  releaseQueueJob: 'agent:release-queue-job',
  cancelJob: 'agent:cancel-job',
  releaseJob: 'agent:release-job',
  reprintJob: 'agent:reprint-job',
  openPrinterSettings: 'agent:open-printer-settings'
} as const

/** Scan & Pack: the local stand-in for TrackVid-BE's /packlog API. */
export const SCANPACK_IPC = {
  create: 'scanpack:create',
  list: 'scanpack:list',
  get: 'scanpack:get',
  remove: 'scanpack:delete',
  upload: 'scanpack:upload',
  download: 'scanpack:download',
  markPacked: 'scanpack:mark-packed',
  print: 'scanpack:print',
  chooseDir: 'scanpack:choose-dir',
  resetDir: 'scanpack:reset-dir',
  openDir: 'scanpack:open-dir',
  setWeeksKept: 'scanpack:set-weeks-kept',
  runCleanup: 'scanpack:run-cleanup',
  saveSource: 'scanpack:save-source',
  mapOrders: 'scanpack:map-orders',
  printPart: 'scanpack:print-part',
  /** One-way: timing lines from the window, printed in the app's terminal. */
  perf: 'scanpack:perf'
} as const
