import { Box, Checkbox, styled, TablePagination, TextField, Tooltip, Typography } from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import React from "react";
import useColumnResize from "../../components/hooks/useColumnResize";
import type { GridRowParams } from "@mui/x-data-grid";

const StyledGridOverlay = styled("div")(({ theme }) => ({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  "& .no-rows-primary": {
    fill: theme.palette.mode === "light" ? "#AEB8C2" : "#3D4751",
  },
  "& .no-rows-secondary": {
    fill: theme.palette.mode === "light" ? "#E8EAED" : "#1D2126",
  },
}));

export function CustomNoRowsOverlay() {
  return (
    <StyledGridOverlay>
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" width={96} viewBox="0 0 452 257" aria-hidden focusable="false">
        <path
          className="no-rows-primary"
          d="M348 69c-46.392 0-84 37.608-84 84s37.608 84 84 84 84-37.608 84-84-37.608-84-84-84Zm-104 84c0-57.438 46.562-104 104-104s104 46.562 104 104-46.562 104-104 104-104-46.562-104-104Z"
        />
        <path
          className="no-rows-primary"
          d="M308.929 113.929c3.905-3.905 10.237-3.905 14.142 0l63.64 63.64c3.905 3.905 3.905 10.236 0 14.142-3.906 3.905-10.237 3.905-14.142 0l-63.64-63.64c-3.905-3.905-3.905-10.237 0-14.142Z"
        />
        <path
          className="no-rows-primary"
          d="M308.929 191.711c-3.905-3.906-3.905-10.237 0-14.142l63.64-63.64c3.905-3.905 10.236-3.905 14.142 0 3.905 3.905 3.905 10.237 0 14.142l-63.64 63.64c-3.905 3.905-10.237 3.905-14.142 0Z"
        />
        <path
          className="no-rows-secondary"
          d="M0 10C0 4.477 4.477 0 10 0h380c5.523 0 10 4.477 10 10s-4.477 10-10 10H10C4.477 20 0 15.523 0 10ZM0 59c0-5.523 4.477-10 10-10h231c5.523 0 10 4.477 10 10s-4.477 10-10 10H10C4.477 69 0 64.523 0 59ZM0 106c0-5.523 4.477-10 10-10h203c5.523 0 10 4.477 10 10s-4.477 10-10 10H10c-5.523 0-10-4.477-10-10ZM0 153c0-5.523 4.477-10 10-10h195.5c5.523 0 10 4.477 10 10s-4.477 10-10 10H10c-5.523 0-10-4.477-10-10ZM0 200c0-5.523 4.477-10 10-10h203c5.523 0 10 4.477 10 10s-4.477 10-10 10H10c-5.523 0-10-4.477-10-10ZM0 247c0-5.523 4.477-10 10-10h231c5.523 0 10 4.477 10 10s-4.477 10-10 10H10c-5.523 0-10-4.477-10-10Z"
        />
      </svg>
      <Box sx={{ mt: 2 }}>No matches found.</Box>
    </StyledGridOverlay>
  );
}

interface Props {
  rows: any;
  columns: any;
  page: number;
  limit: number;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  selectedRow?: string[];
  setSelectedRow?: (selectedRow: string[]) => void;
  isLoading?: boolean;
  rowHeight?: number;
  totalRow: number;
  checkboxSelection?: boolean;
  clientSidePagination?: boolean;
  pageOptions?: boolean;
  height?: object;
  onRowClicked?: (row: any) => void;
  columnVisibilityModel?: { [key: string]: boolean };
  // Optional handler for user-initiated column visibility changes (e.g. via the
  // column header menu's "Hide column" / "Manage columns"). Required if the
  // parent wants those toggles to actually persist — without it the menu is
  // effectively read-only because columnVisibilityModel is a controlled prop.
  onColumnVisibilityModelChange?: (model: { [key: string]: boolean }) => void;
  hideFooter?: boolean;
  isRowSelectable?: (params: GridRowParams) => boolean;
  showSelectAllCheckbox?: boolean; // When true, shows "select all" checkbox in header (VMS only)
  // Optional per-row explanation for why its checkbox is disabled. When it
  // returns a string the checkbox gets a hover tooltip carrying that text
  // (e.g. "Reached limit of retry"). Return undefined for no tooltip.
  selectionDisabledReason?: (params: GridRowParams) => string | undefined;
  maxSelection?: number; // Cap the count picked by the header "select all" (and prevent ticking more rows once reached)
}

const DataTable = ({
  rows,
  columns,
  page,
  limit,
  setPage,
  setLimit,
  selectedRow,
  setSelectedRow,
  isLoading = false,
  rowHeight = 40,
  totalRow,
  checkboxSelection = false,
  clientSidePagination = false,
  // Divided by 0.95 to cancel the body-level `zoom: 0.95` (index.css),
  // otherwise the card renders ~5vh short and leaves empty space below it.
  height = {
    xs: "calc((100vh - 240px) / 0.95)",
    sm: "calc((100vh - 240px) / 0.95)",
    md: "calc((100vh - 240px) / 0.95)",
    lg: "calc((100vh - 240px) / 0.95)",
    xl: "calc((100vh - 180px) / 0.95)",
  },
  onRowClicked,
  columnVisibilityModel,
  onColumnVisibilityModelChange,
  hideFooter = false,
  isRowSelectable,
  showSelectAllCheckbox = false,
  maxSelection,
  selectionDisabledReason,
}: Props) => {
  const debounce = <T extends (value: any) => void>(func: T, delay: number): ((...args: Parameters<T>) => void) => {
    let debounceTimer: ReturnType<typeof setTimeout>;
    return function (this: any, ...args: Parameters<T>) {
      const context = this;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => func.apply(context, args), delay);
    };
  };

  const handlePageChange = (data: { page: number; pageSize: number }) => {
    setPage(data.page + 1);
    setLimit(data.pageSize);
  };

  // debounce page change to avoid multiple requests (Prevent from looping request)
  const debouncePageChange = debounce(handlePageChange, 700);
  const { resetColumnSize } = useColumnResize();
  const selectionEnabled = Boolean(checkboxSelection && setSelectedRow);
  
  // Get selectable row IDs for "select all" (only when showSelectAllCheckbox is true)
  const selectableRowIds = React.useMemo(() => {
    if (!showSelectAllCheckbox || !rows?.length) return [];
    return rows
      .filter((row: any) => {
        if (!isRowSelectable) return true;
        try {
          return isRowSelectable({ id: row.id, row } as GridRowParams);
        } catch {
          return true;
        }
      })
      .map((row: any) => String(row.id));
  }, [rows, isRowSelectable, showSelectAllCheckbox]);

  const selectedRows = selectedRow || [];
  // When a maxSelection cap is set, "select all" picks the first N eligible rows rather than every visible row.
  const selectAllTargetIds = React.useMemo(
    () => (maxSelection ? selectableRowIds.slice(0, maxSelection) : selectableRowIds),
    [selectableRowIds, maxSelection]
  );
  const allSelectableSelected = selectAllTargetIds.length > 0 && selectAllTargetIds.every((id: string) => selectedRows.includes(id));
  const someSelectableSelected = selectAllTargetIds.some((id: string) => selectedRows.includes(id));
  const selectionCapReached = typeof maxSelection === "number" && selectedRows.length >= maxSelection;

  const effectiveColumns = selectionEnabled
    ? [
        {
          field: "__selection__",
          headerName: "",
          width: 50,
          sortable: false,
          filterable: false,
          disableColumnMenu: true,
          ...(showSelectAllCheckbox && {
            renderHeader: () => (
              <Checkbox
                size="small"
                checked={allSelectableSelected}
                indeterminate={someSelectableSelected && !allSelectableSelected}
                disabled={selectAllTargetIds.length === 0}
                onChange={(e) => {
                  if (!setSelectedRow) return;
                  if (e.target.checked) {
                    setSelectedRow([...new Set([...selectedRows, ...selectAllTargetIds])]);
                  } else {
                    setSelectedRow(selectedRows.filter((id: string) => !selectAllTargetIds.includes(id)));
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ),
          }),
          renderCell: (params: any) => {
            const rowId = String(params.id);
            const isSelectable = isRowSelectable ? isRowSelectable(params) : true;
            const checked = (selectedRow || []).includes(rowId);
            const blockedByCap = selectionCapReached && !checked;
            const disabledReason = selectionDisabledReason ? selectionDisabledReason(params) : undefined;
            const checkbox = (
              <Checkbox
                size="small"
                checked={checked}
                disabled={!isSelectable || blockedByCap}
                onChange={(e) => {
                  if (!setSelectedRow || !isSelectable) return;
                  if (e.target.checked) {
                    if (blockedByCap) return;
                    setSelectedRow([...(selectedRow || []), rowId]);
                  } else {
                    setSelectedRow((selectedRow || []).filter((id) => id !== rowId));
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            );
            return (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                  height: "100%",
                }}
              >
                {disabledReason ? (
                  // A disabled MUI Checkbox fires no pointer events, so the
                  // tooltip has to hang off a wrapper span, not the input.
                  <Tooltip title={disabledReason} arrow>
                    <span style={{ display: "inline-flex", cursor: "not-allowed" }}>{checkbox}</span>
                  </Tooltip>
                ) : (
                  checkbox
                )}
              </Box>
            );
          },
        },
        ...columns,
      ]
    : columns;
  return (
    <Box
      sx={{
        height: height,
        width: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <DataGrid
        // density="compact"
        onColumnResize={(e: any) => resetColumnSize(e)}
        disableColumnSorting
        disableRowSelectionOnClick
        rows={rows}
        columns={effectiveColumns}
        rowHeight={rowHeight}
        loading={isLoading}
        rowCount={totalRow}
        paginationMode={`${clientSidePagination ? "client" : "server"}`}
        isRowSelectable={isRowSelectable}
        initialState={{
          pagination: {
            paginationModel: { page: +page - 1, pageSize: +limit },
          },
        }}
        // Controlled prop — initialState only applies on mount, so prop changes
        // (e.g. switching the D2C pill) would otherwise be ignored.
        {...(columnVisibilityModel && { columnVisibilityModel })}
        {...(onColumnVisibilityModelChange && { onColumnVisibilityModelChange })}
        paginationModel={!clientSidePagination ? { page: +page - 1, pageSize: +limit } : undefined}
        hideFooter={hideFooter}
        // onPaginationModelChange={(data) => debouncePageChange(data)}
        // pageSizeOptions={clientSidePagination ? [10, 20, 50, 100] : []}

        slots={{
          noRowsOverlay: CustomNoRowsOverlay,
          ...(!clientSidePagination && {
            footer: () => {
              return (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "end",
                    borderTop: "1px solid #E0E0E0",
                    flexDirection: {
                      xs: "column",
                      sm: "row",
                      md: "row",
                      lg: "row",
                      xl: "row",
                    },
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      paddingTop: {
                        xs: 2,
                        sm: 0,
                        md: 0,
                        lg: 0,
                        xl: 0,
                      },
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        padding: 1,
                      }}
                    >
                      Page
                    </Typography>
                    <TextField
                      type="tel"
                      defaultValue={page}
                      placeholder="Page"
                      onChange={(e) => {
                        if (!e.target.value) return;
                        if (+e.target.value > Math.ceil(totalRow / limit)) {
                          debouncePageChange({ page: Math.ceil(totalRow / limit) - 1, pageSize: limit });
                        } else {
                          debouncePageChange({ page: +e.target.value - 1, pageSize: limit });
                        }
                      }}
                      inputProps={{
                        min: 1,
                        max: Math.ceil(totalRow / limit),
                        style: {
                          textAlign: "center",
                          height: 15,
                        },
                      }}
                      size="small"
                      variant="outlined"
                      sx={{ 
                        width: {
                          xs: 40,
                          sm: 60,
                          md: 60,
                          lg: 60,
                          xl: 60,
                        },
                      }}
                    />
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        padding: 1,
                      }}
                    >
                      Of
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.primary",
                        padding: 1,
                        fontWeight: 600,
                      }}
                    >
                      {Math.ceil(totalRow / limit)}
                    </Typography>
                  </Box>
                  <TablePagination
                    rowsPerPageOptions={[10, 20, 25, 50, 100]}
                    component="div"
                    count={totalRow}
                    rowsPerPage={limit}
                    page={page - 1}
                    onPageChange={(_, page) => setPage(page + 1)}
                    onRowsPerPageChange={(e) => setLimit(+e.target.value)}
                  />
                </Box>
              );
            },
          }),
        }}
        sx={(theme) => ({
          "--DataGrid-overlayHeight": "300px",
          fontSize: "0.75rem",
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: "6px",
          backgroundColor: "background.paper",
          boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 8px 24px rgba(16,24,40,0.06)",
          "& .MuiDataGrid-columnHeaders": {
            backgroundColor: theme.palette.mode === "light" ? "#F8FAFB" : "#0E1428",
            borderBottom: `1px solid ${theme.palette.divider}`,
          },
          "& .MuiDataGrid-columnHeaderTitle": {
            fontWeight: 600,
            fontSize: "0.75rem",
            color: theme.palette.text.secondary,
            letterSpacing: 0.2,
          },
          "& .MuiDataGrid-cell": {
            borderBottom: `1px solid ${theme.palette.divider}`,
            display: "flex",
            alignItems: "center",
          },
          "& .MuiDataGrid-row:hover": {
            backgroundColor: "rgba(0,136,163,0.04)",
          },
          "& .MuiDataGrid-cell:focus-within": { outline: "none" },
          "& .MuiDataGrid-main:focus-visible": { outline: "none" },
          "& .MuiDataGrid-columnHeader": {
            display: "flex",
            alignItems: "center",
            "&:hover .MuiDataGrid-menuIcon": { visibility: "visible" },
            "& .MuiDataGrid-menuIcon": {
              visibility: "visible",
              width: "auto",
            },
          },
          "& .MuiDataGrid-footerContainer": {
            borderTop: `1px solid ${theme.palette.divider}`,
          },
          "& .MuiDataGrid-panel .MuiPaper-root": {
            borderRadius: "6px",
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: "0 8px 24px rgba(16,24,40,0.10), 0 2px 6px rgba(16,24,40,0.06)",
          },
          "& .MuiDataGrid-filterForm": {
            alignItems: "flex-end",
            gap: 12,
            padding: "12px 16px",
          },
          "& .MuiDataGrid-filterFormDeleteIcon": {
            alignSelf: "flex-end",
            marginBottom: 4,
            "& .MuiButtonBase-root": {
              padding: 6,
              borderRadius: "6px",
              "&:hover": { backgroundColor: "rgba(0,136,163,0.08)" },
            },
          },
        })}
        
        checkboxSelection={false}
        onRowClick={(params) => {
          if (onRowClicked) {
            onRowClicked(params);
          }
        }}
        onRowSelectionModelChange={
          selectionEnabled
            ? undefined
            : (newRowSelectionModel) => {
                // DataGrid v8: the model is { type, ids: Set } instead of an array.
                setSelectedRow && setSelectedRow(Array.from(newRowSelectionModel.ids, String));
              }
        }
        rowSelectionModel={
          selectionEnabled
            ? undefined
            : { type: "include", ids: new Set(selectedRow ? selectedRow.slice(0, 1) : []) }
        }
        disableColumnResize={false}
        // onFilterModelChange={() => {
        //   setPage(1);
        // }}
      />
    </Box>
  );
};

export default React.memo(DataTable);
