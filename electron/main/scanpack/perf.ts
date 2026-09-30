import { logger } from '../logger'

/**
 * Scan & Pack timing lines, printed in the terminal the app runs in
 * (`npm run dev`, or the binary started from a shell) and kept in agent.log.
 * stdout directly rather than console.log: this is output, not debugging.
 */
export const printPerf = (lines: readonly string[]): void => {
  for (const line of lines) {
    process.stdout.write(`[scanpack:time] ${line}\n`)
    logger.info(`[scanpack:time] ${line}`)
  }
}

/** Milliseconds since `start`, rounded, for a log line. */
export const since = (start: number): number => Math.round(performance.now() - start)
