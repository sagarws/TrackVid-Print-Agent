/** IPC channel names between the window and the main process. */
export const IPC = {
  getState: 'agent:get-state',
  state: 'agent:state',
  refreshPrinters: 'agent:refresh-printers',
  testPrint: 'agent:test-print',
  setAllowedOrigins: 'agent:set-allowed-origins',
  setOpenAtLogin: 'agent:set-open-at-login',
  setThemeMode: 'agent:set-theme-mode'
} as const
