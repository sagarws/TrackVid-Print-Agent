import { useEffect } from "react";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import ScanAndPack from "./pages/ScanAndPack";
import ScanAndPackBatch from "./pages/ScanAndPackBatch";
import ScanAndPackPack from "./pages/ScanAndPackPack";
import { ROUTE_URLS } from "./config/route";

/** Reports the current path up, so coming back to Scan and Pack reopens the same screen. */
const LocationReporter = ({ onChange }: { onChange: (path: string) => void }) => {
  const location = useLocation();
  useEffect(() => {
    onChange(location.pathname);
  }, [location.pathname, onChange]);
  return null;
};

/**
 * The Scan & Pack screens ported from TrackVid-FE, on their own in-memory
 * router so their `navigate("/scan-and-pack/…")` calls work unchanged.
 *
 * Unmounted whenever another sidebar page is open — deliberately: the pack
 * screen listens for barcode scans on the whole window, and a scan made on
 * Home must not print a parcel.
 */
const ScanPackSection = ({ initialPath, onPathChange }: { initialPath: string; onPathChange: (path: string) => void }) => (
  <MemoryRouter initialEntries={[initialPath]}>
    <LocationReporter onChange={onPathChange} />
    <Routes>
      <Route path={ROUTE_URLS.SCAN_AND_PACK} element={<ScanAndPack />} />
      <Route path={ROUTE_URLS.SCAN_AND_PACK_BATCH} element={<ScanAndPackBatch />} />
      <Route path={ROUTE_URLS.SCAN_AND_PACK_PACK} element={<ScanAndPackPack />} />
      <Route path={ROUTE_URLS.SCAN_AND_PACK_PACK_ORDER} element={<ScanAndPackPack />} />
      <Route path="*" element={<Navigate to={ROUTE_URLS.SCAN_AND_PACK} replace />} />
    </Routes>
  </MemoryRouter>
);

export default ScanPackSection;
