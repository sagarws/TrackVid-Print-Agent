import { Box, Paper, Stack, Typography } from "@mui/material";
import { Page } from "./Page";
import {
  SaveMappingButton,
  ShowMappingDataButton,
  SkuMappingBody,
  useSkuMapping,
} from "../components/ScanAndPack/SkuMappingModal";

/** Sidebar → SKU Mapping: the SKU Mapping modal's content, as a page. */
const SkuMappingPage = () => {
  const mapping = useSkuMapping();

  return (
    <Page title="SKU Mapping">
      <Box sx={{ mb: 2 }}>
        <Typography sx={{ fontSize: "1.125rem", fontWeight: 700, color: "text.primary" }}>SKU Mapping</Typography>
        <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.25 }}>
          Master SKU → listing SKUs, used to tag every packlog order.
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ borderRadius: "10px", overflow: "hidden", maxWidth: 960 }}>
        <Stack spacing={2} sx={{ p: 2.5 }}>
          <SkuMappingBody mapping={mapping} />
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          justifyContent="flex-end"
          sx={{ px: 2.5, py: 1.5, borderTop: (t) => `1px solid ${t.palette.divider}` }}
        >
          <ShowMappingDataButton mapping={mapping} />
          <SaveMappingButton mapping={mapping} />
        </Stack>
      </Paper>
    </Page>
  );
};

export default SkuMappingPage;
