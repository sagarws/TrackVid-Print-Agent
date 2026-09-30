/** Scan & Pack routes, inside the section's own in-memory router (see ScanPackSection). */
export const ROUTE_URLS = {
  SCAN_AND_PACK: "/scan-and-pack",
  SCAN_AND_PACK_BATCH: "/scan-and-pack/:batchId",
  SCAN_AND_PACK_PACK: "/scan-and-pack/:batchId/pack",
  SCAN_AND_PACK_PACK_ORDER: "/scan-and-pack/:batchId/pack/:orderId",
} as const;

export default ROUTE_URLS;
