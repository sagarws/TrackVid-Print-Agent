/** The column-width part of TrackVid-FE's LocalStorageService, which DataTable's resize hook uses. */
const COLUMN_RESIZE = "column_resize";

const readJson = (key: string): Record<string, unknown> => {
  try {
    const data = localStorage.getItem(key);
    return data ? (JSON.parse(data) as Record<string, unknown>) : {};
  } catch {
    // Unreadable or blocked storage: start with default widths.
    return {};
  }
};

const LocalStorageService = {
  getColumnSize: () => readJson(COLUMN_RESIZE),
  setColumnSize: (value: string) => {
    try {
      localStorage.setItem(COLUMN_RESIZE, value);
    } catch {
      // Storage full or blocked: widths just won't be remembered.
    }
  },
};

export default LocalStorageService;
