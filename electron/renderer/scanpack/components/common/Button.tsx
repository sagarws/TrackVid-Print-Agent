import { Button, type ButtonProps, CircularProgress } from "@mui/material";
import React from "react";

interface Props extends ButtonProps {
  loading?: boolean;
  children: string | React.ReactNode;
  disabled? : boolean
}

// Only the contained variant gets the white-text default; outlined and text
// variants use the theme colour so they stay legible on light backgrounds.
// Any call site that needs white text on an outlined button should override
// via `sx={{ color: "white" }}` explicitly (previously this component forced
// white on every variant, which made outlined buttons invisible in light
// containers like DialogActions).
const ButtonElement = ({ sx, children, loading = false, disabled= false ,...props }: Props) => {
  const isContained = props.variant === "contained";
  return (
    <Button
      sx={{
        ":focus": {
          outline: "none",
        },
        ...(isContained ? { color: "white" } : {}),
        ...sx,
      }}
      {...props}
      disabled = {loading || disabled}
    >
      {loading ? <CircularProgress size={24} color="secondary" /> : children}
    </Button>
  );
};

export default ButtonElement;
