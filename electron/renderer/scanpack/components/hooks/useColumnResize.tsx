import { useLocation } from "react-router-dom";
import LocalStorageService from "../../helper/localstorage-service";

/**
 * Remembers each grid's column widths per screen (TrackVid-FE's hook). Saved
 * widths are read fresh on every resize, so two resizes in one render never
 * overwrite each other.
 */
const useColumnResize = () => {
  const location = useLocation();
  const path = location.pathname.replace(/\//g, "");
  const saved = LocalStorageService.getColumnSize() as Record<string, Record<string, number>>;

  const resetColumnSize = (e: any) => {
    const colProps: { field: string; width: number | string } = e.colDef;
    const current = LocalStorageService.getColumnSize() as Record<string, Record<string, number>>;
    const next = { ...current, [path]: { ...current[path], [colProps.field]: parseInt(String(colProps.width)) } };
    LocalStorageService.setColumnSize(JSON.stringify(next));
  };

  return { columnSize: saved?.[path] || {}, resetColumnSize };
};

export default useColumnResize;
