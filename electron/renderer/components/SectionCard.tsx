import type { ReactNode } from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
import IconTile from './IconTile'

interface Props {
  icon: string
  tone?: 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info'
  title: string
  subtitle?: ReactNode
  action?: ReactNode
  /** Tints the card, as the Status card does. */
  tint?: 'success' | 'error'
  children: ReactNode
}

/** Card chrome shared by the Home screen: icon tile, title, subtitle, action. */
const SectionCard = ({ icon, tone, title, subtitle, action, tint, children }: Props) => (
  <Paper
    variant='outlined'
    sx={{
      p: 4,
      borderRadius: 3,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      ...(tint ? { bgcolor: `var(--mui-palette-${tint}-lighterOpacity)` } : {})
    }}
  >
    <Stack direction='row' spacing={2.5} alignItems='flex-start' sx={{ mb: 3 }}>
      <IconTile icon={icon} tone={tone} />
      <Box sx={{ flex: 1, minWidth: 0, pt: 0.5 }}>
        <Typography variant='h6' sx={{ fontSize: 16, fontWeight: 600 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant='body2' color='text.secondary' sx={{ fontSize: 12.5, mt: 0.25 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action}
    </Stack>
    <Box sx={{ flex: 1 }}>{children}</Box>
  </Paper>
)

export default SectionCard
