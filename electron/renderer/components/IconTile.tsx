import { Box } from '@mui/material'

type Tone = 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info'

/** The round tinted icon badge at the head of every card. */
const IconTile = ({ icon, tone = 'primary', size = 44 }: { icon: string; tone?: Tone; size?: number }) => (
  <Box
    sx={{
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: '50%',
      display: 'grid',
      placeItems: 'center',
      color: `${tone}.main`,
      bgcolor: `var(--mui-palette-${tone}-lightOpacity)`
    }}
  >
    <i className={icon} style={{ fontSize: size * 0.5 }} />
  </Box>
)

export default IconTile
