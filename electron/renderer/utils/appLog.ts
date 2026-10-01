/**
 * A log line from the window, written to the DevTools console AND — through
 * the main process — to the terminal running the app and agent.log, where it
 * survives a white screen or a restart.
 */
export const appLog = (level: 'info' | 'warn' | 'error', scope: string, message: string): void => {
  const line = `[${scope}] ${message}`
  // Info stays out of the console (the terminal and agent.log have it);
  // warnings and errors also show in DevTools.
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  try {
    window.printAgent.log(level, scope, message)
  } catch {
    // The bridge is missing only if preload failed — which main logs itself.
  }
}
