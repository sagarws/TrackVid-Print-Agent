import { Box, Typography } from "@mui/material";
import { AccountTreeOutlined, UploadFileOutlined } from "@mui/icons-material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Page } from "./Page";
import ButtonElement from "../components/common/Button";
import UploadSessionModal from "../components/ScanAndPack/UploadSessionModal";
import SkuMappingModal from "../components/ScanAndPack/SkuMappingModal";
import PacklogListTable from "../components/ScanAndPack/PacklogListTable";

const ScanAndPack = () => {
  const navigate = useNavigate();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [skuMappingOpen, setSkuMappingOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <Page title="Scan and Pack">
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 1.5,
          mb: 2,
          width: "100%",
        }}
      >
        <Box>
          <Typography sx={{ fontSize: "1.125rem", fontWeight: 700, color: "text.primary" }}>
            Upload Packlog files
          </Typography>
          <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.25 }}>
            Each packlog pairs an order list with its label &amp; invoice PDFs and maps them by AWB Number.
          </Typography>
        </Box>

        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <ButtonElement
          type="button"
          variant="outlined"
          startIcon={<AccountTreeOutlined sx={{ fontSize: 14 }} />}
          onClick={() => setSkuMappingOpen(true)}
          sx={{
            color: "primary.main",
            textTransform: "none",
            fontSize: 13,
            fontWeight: 600,
            height: 32,
            px: 2,
            whiteSpace: "nowrap",
            "& .MuiButton-startIcon": { mr: 0.5 },
          }}
        >
          SKU Mapping
        </ButtonElement>
        <ButtonElement
          type="button"
          variant="contained"
          startIcon={<UploadFileOutlined sx={{ fontSize: 14 }} />}
          onClick={() => setUploadOpen(true)}
          sx={{
            color: "white",
            textTransform: "none",
            fontSize: 13,
            fontWeight: 600,
            height: 32,
            px: 2,
            whiteSpace: "nowrap",
            "& .MuiButton-startIcon": { mr: 0.5 },
          }}
        >
          Upload Packlog files
        </ButtonElement>
        </Box>
      </Box>

      <PacklogListTable
        refreshKey={refreshKey}
        onOpen={(id) => navigate(`/scan-and-pack/${encodeURIComponent(id)}`)}
      />

      {uploadOpen && (
        <UploadSessionModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onCreated={() => {
            setUploadOpen(false);
            // Refetch so the new packlog appears on page 1 with its true mapped count.
            setRefreshKey((key) => key + 1);
          }}
        />
      )}

      {skuMappingOpen && (
        <SkuMappingModal open={skuMappingOpen} onClose={() => setSkuMappingOpen(false)} />
      )}
    </Page>
  );
};

export default ScanAndPack;
