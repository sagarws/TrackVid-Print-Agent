import { useEffect, useRef } from "react";

/**
 * Detect a hardware barcode / QR scanner anywhere on the page.
 *
 * A keyboard-wedge scanner (every USB scanner we ship with, 1D or 2D) is
 * indistinguishable from a keyboard except for its speed: it replays the
 * decoded payload as keystrokes in a few milliseconds and terminates with
 * Enter. A human types the same string in seconds. So the rule is simply
 * "a burst of fast keystrokes ending in Enter is a scan".
 *
 * Listening on `document` rather than on the input is deliberate: the operator
 * should be able to scan the next parcel straight after clicking a button or a
 * grid row, without first clicking back into the field.
 *
 * What it will NOT treat as a scan:
 *  - anything typed at human speed;
 *  - anything shorter than `minLength`, which keeps a stray Enter from firing;
 *  - anything aimed at a form field. That exclusion is what stops a parcel
 *    printing twice: when the scan lands in a focused input, the characters
 *    go into that field and the field's own Enter handler commits it, so this
 *    hook must stay out of the way. It exists purely for the case where focus
 *    is on a button, the body, or a grid row and the keystrokes would
 *    otherwise go nowhere.
 */
export interface BarcodeScannerOptions {
  /** Called with the decoded payload once a burst is confirmed as a scan. */
  onScan: (value: string) => void;
  /**
   * Longest gap between two keystrokes that still counts as machine speed.
   * 35ms is comfortably above what the slowest scanners emit (~10-15ms) and
   * far below a fast human (~90-120ms between keys).
   */
  maxKeyIntervalMs?: number;
  /** Shortest payload worth acting on. Real AWBs and SKUs are far longer. */
  minLength?: number;
  /** Set false to suspend detection, e.g. while a modal owns the screen. */
  enabled?: boolean;
}

const isFormField = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

export const useBarcodeScanner = ({
  onScan,
  maxKeyIntervalMs = 35,
  minLength = 4,
  enabled = true,
}: BarcodeScannerOptions) => {
  // The callback is read through a ref so a caller passing an inline arrow
  // function does not tear down and re-attach the listener on every render.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    let buffer = "";
    let lastKeyAt = 0;

    const handleKeyDown = (event: KeyboardEvent) => {
      // A scanner never holds a modifier. This also keeps Ctrl/Cmd shortcuts
      // from being shredded into the buffer.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        buffer = "";
        return;
      }
      if (isFormField(event.target)) {
        buffer = "";
        return;
      }

      const now = Date.now();
      const gap = now - lastKeyAt;
      lastKeyAt = now;

      if (event.key === "Enter") {
        const payload = buffer;
        buffer = "";
        // The terminating Enter has to arrive at machine speed too, otherwise
        // a hand-typed string that happened to be fast would qualify.
        if (payload.length >= minLength && gap <= maxKeyIntervalMs) {
          onScanRef.current(payload);
        }
        return;
      }

      // Printable single characters only — ignore Shift, Tab, arrows, F-keys.
      if (event.key.length !== 1) {
        buffer = "";
        return;
      }

      // Too slow to be a machine: start a new burst from this character
      // instead of appending to what a human typed earlier.
      buffer = gap > maxKeyIntervalMs ? event.key : buffer + event.key;
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, maxKeyIntervalMs, minLength]);
};

export default useBarcodeScanner;
