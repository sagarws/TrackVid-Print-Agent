import { forwardRef, type ReactNode } from "react";
import { Box, type BoxProps } from "@mui/material";

/**
 * TrackVid-FE's page wrapper, without react-helmet: the window title is the
 * app's own, so `title` is accepted and ignored.
 */
type Props = BoxProps & { title?: string; children?: ReactNode };

export const Page = forwardRef<HTMLDivElement, Props>(({ children, title: _title, ...rest }, ref) => (
  <Box ref={ref} {...rest}>
    {children}
  </Box>
));

Page.displayName = "Page";

export default Page;
