/*
 * PORTED FROM TrackVid-Monitor (src/@core/theme/index.ts), with one change.
 *
 * Monitor loads Public Sans through `next/font/google`, which fetches it at
 * build time and serves it from the app's own origin. A packaged desktop app
 * has no build step at the customer and may have no network at all, so the
 * font is vendored as woff2 files and declared in styles/fonts.css under the
 * family name this theme already falls back to.
 *
 * `typography('')` is what asks for that fallback stack — the same one Monitor
 * ends up with, spelled out in typography.ts rather than generated.
 */

// MUI Imports
import type { Theme } from '@mui/material/styles'

// Type Imports
import type { Settings } from '@core/contexts/settingsContext'
import type { SystemMode, Skin } from '@core/types'

// Theme Options Imports
import overrides from './overrides'
import colorSchemes from './colorSchemes'
import spacing from './spacing'
import shadows from './shadows'
import customShadows from './customShadows'
import typography from './typography'

const theme = (settings: Settings, mode: SystemMode, direction: Theme['direction']): Theme => {
  return {
    direction,
    components: overrides(settings.skin as Skin),
    colorSchemes: colorSchemes(settings.skin as Skin),
    ...spacing,
    shape: {
      borderRadius: 6,
      customBorderRadius: {
        xs: 2,
        sm: 4,
        md: 6,
        lg: 8,
        xl: 10
      }
    },
    shadows: shadows(mode),
    typography: typography(''),
    customShadows: customShadows(mode),
    mainColorChannels: {
      light: '47 43 61',
      dark: '225 222 245',
      lightShadow: '47 43 61',
      darkShadow: '19 17 32'
    }
  } as Theme
}

export default theme
