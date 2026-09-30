/**
 * Printer access for the ported Scan & Pack screens — the same exports as
 * TrackVid-FE's print-agent.ts, but in-process: inside the agent there is no
 * HTTP hop, the printer list is the agent's own and jobs go straight onto its
 * print queue (electron/main/scanpack/ipc.ts → jobs.ts).
 */
export type AgentAvailability =
  | { status: "ready" }
  | { status: "not-allowed"; origin: string }
  | { status: "unavailable" };

export type AgentPrinterState = "ready" | "printing" | "paused" | "offline" | "error" | "unknown";

export interface AgentPrinter {
  name: string;
  displayName: string;
  isDefault?: boolean;
  status?: { state: AgentPrinterState; message: string };
  queuedJobs?: number;
}

export const isPrinterBlocked = (printer: AgentPrinter): boolean =>
  printer.status?.state === "offline" ||
  printer.status?.state === "paused" ||
  printer.status?.state === "error";

/** Always ready: this code runs inside the agent. */
export const checkAgent = (): Promise<AgentAvailability> => Promise.resolve({ status: "ready" });

/** The printers the agent sees. `refresh` re-reads the OS and checks each device now. */
export const listPrinters = async (options: { refresh?: boolean } = {}): Promise<AgentPrinter[]> => {
  if (options.refresh) await window.printAgent.refreshPrinters();
  const state = await window.printAgent.getState();
  return (state?.printers ?? []).map((printer) => ({
    name: printer.name,
    displayName: printer.displayName,
    isDefault: printer.isDefault,
    status: { state: printer.status.state, message: printer.status.message },
    queuedJobs: printer.queue.length,
  }));
};

/**
 * Print a PDF on a named printer. Resolves once the OS queue accepted it;
 * rejects with the agent's reason ("Printer is offline") otherwise.
 */
export const printPdfToPrinter = async (bytes: Uint8Array, printer: string, jobName: string): Promise<void> => {
  const result = await window.printAgent.scanPack.print(printer, bytes, jobName);
  if (!result.ok) throw new Error(result.error);
};
