// React Imports
import { useEffect, useMemo, type ReactNode } from 'react'

// MUI Imports
import { deepmerge } from '@mui/utils'
import {
  createTheme,
  darken,
  getLuminance,
  lighten,
  ThemeProvider,
  useColorScheme
} from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import type {} from '@mui/material/themeCssVarsAugmentation' //! Do not remove: production builds type-error without it
import type {} from '@mui/lab/themeAugmentation' //! Do not remove: production builds type-error without it

// Third-party Imports
import createCache from '@emotion/cache'
import { CacheProvider } from '@emotion/react'

// Type Imports
import type { Skin, SystemMode } from '@core/types'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'
import { useMedia } from '@core/hooks/useMedia'

// Core Theme Imports
import coreTheme from '@core/theme'

// The Vercel re-dress, merged over the core theme. See vercelTheme.ts.
import vercelTheme from './vercelTheme'

/** The dark scheme's accent when the operator's accent is ink — Geist's dark text. */
const DARK_INK_ACCENT = '#EDEDED'
/** Text on that accent — Geist's dark panel. */
const DARK_INK_CONTRAST = '#0A0A0A'

// Type Imports
import type { ThemeFont } from '@shared/types/appearance'

/**
 * The font stacks, in the order each one should be tried.
 *
 * Every entry begins with a family declared in styles/fonts.css from a file
 * that ships with the app, and falls back to the same native stack Monitor's
 * typography ends with — so a machine that somehow cannot load the woff2 still
 * renders in something sensible rather than in Times.
 */
const NATIVE_STACK =
  'sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial'

const FONT_STACK: Record<ThemeFont, string> = {
  // Geist first: it is what a fresh installation opens in, and it is half of
  // why the app reads as Vercel. Public Sans sits behind it as the fallback
  // rather than the native stack, so a Geist file that somehow fails to load
  // lands on the other bundled grotesque instead of on the OS UI face.
  geist: `"Geist", "Public Sans", ${NATIVE_STACK}`,
  'public-sans': `"Public Sans", ${NATIVE_STACK}`,
  inter: `"Inter", "Public Sans", ${NATIVE_STACK}`,
  system: NATIVE_STACK
}

/**
 * PORTED FROM TrackVid-Monitor (src/components/theme/index.tsx).
 *
 * Same theme object, same merge, same `colorSchemeSelector: 'data'`. Three
 * things differ, all of them Next machinery this app does not have:
 *
 *   `AppRouterCacheProvider` is Next's Emotion wiring — it exists to get styles
 *   into the server-rendered HTML. Nothing renders on a server here, so it is a
 *   plain Emotion cache with `prepend` set, which is the part that actually
 *   matters: it puts MUI's styles BEFORE Tailwind's so a utility class can win.
 *
 *   The RTL branch is gone with RTL.
 *
 *   `useMedia` is ours rather than react-use's. See the hook.
 *
 * Emotion injects a <style> element per rule at runtime, which the renderer's
 * Content-Security-Policy has to allow. It already does — `style-src 'self'
 * 'unsafe-inline'` in index.html — and that is not an accident to be tidied
 * away later: remove the inline allowance and every MUI component loses its
 * styling in the packaged build only, where it is hardest to notice.
 */

/*
 * `prepend: true` is load-bearing, not a preference. Emotion appends its style
 * elements to <head> by default, which would put MUI's generated rules AFTER
 * the Tailwind layers and make `className` overrides on a MUI component lose.
 * Monitor sets the same option for the same reason.
 */
const emotionCache = createCache({ key: 'mui', prepend: true })

/**
 * Keeps MUI's own colour-scheme state in step with the operator's choice.
 *
 * Ported from Monitor's ModeChanger. `system` is a real third state — it
 * follows the OS — so it is resolved here rather than stored resolved.
 */
const ModeChanger = ({ systemMode }: { systemMode: SystemMode }) => {
  const { setMode } = useColorScheme()
  const { settings } = useSettings()
  const isDark = useMedia('(prefers-color-scheme: dark)', systemMode === 'dark')

  useEffect(() => {
    if (!settings.mode) return

    setMode(settings.mode === 'system' ? (isDark ? 'dark' : 'light') : settings.mode)
  }, [isDark, setMode, settings.mode])

  return null
}

export const VuexyThemeProvider = ({
  children,
  systemMode
}: {
  children: ReactNode
  /** What the window was opened in, so the first frame is not the wrong one. */
  systemMode: SystemMode
}) => {
  const { settings } = useSettings()
  const isDark = useMedia('(prefers-color-scheme: dark)', systemMode === 'dark')

  const currentMode: SystemMode =
    settings.mode === 'system' ? (isDark ? 'dark' : 'light') : (settings.mode as SystemMode)

  const theme = useMemo(() => {
    const primary = settings.primaryColor as string

    // The operator's primary colour, laid over both schemes — the rest of the
    // palette comes from Monitor's colorSchemes unchanged.
    const primaryOverride = {
      palette: {
        primary: {
          main: primary,
          light: lighten(primary, 0.2),
          dark: darken(primary, 0.1)
        }
      }
    }

    /*
     * THE DARK SCHEME INVERTS AN INK ACCENT.
     *
     * The shipped accent is a near-black, and on the dark scheme's black page
     * a near-black filled button all but disappears — the filled Re-capture on
     * an expired login, the one button on the Login page that most needs
     * seeing, was the hardest thing to find. Vercel's own dark UI does exactly
     * this: its primary button is white on black.
     *
     * Only for an accent that IS ink (luminance under 5%). An operator who
     * picked teal keeps teal in both schemes; this changes nothing they chose.
     */
    const darkPrimaryOverride =
      getLuminance(primary) < 0.05
        ? {
            palette: {
              primary: {
                main: DARK_INK_ACCENT,
                light: lighten(DARK_INK_ACCENT, 0.2),
                dark: darken(DARK_INK_ACCENT, 0.1),
                contrastText: DARK_INK_CONTRAST
              }
            }
          }
        : primaryOverride

    /*
     * THREE LAYERS, AND THE ORDER IS THE POINT.
     *
     *   1. coreTheme    — Monitor's ported theme, untouched.
     *   2. vercelTheme  — the re-dress: Geist greys, flat edges, Vercel's
     *                     component chrome. Overwrites most of layer 1.
     *   3. primaryOverride — the operator's accent, LAST so it wins.
     *
     * WHAT KEEPS THE CUSTOMISER WORKING is not this order — it is that
     * vercelTheme never defines `palette.primary` at all, in either scheme. The
     * near-black is shipped as the first swatch in primaryColorConfig, so it
     * arrives through layer 3 like any other choice, and someone who picks teal
     * gets teal on Vercel's greys. There is a test pinning that absence
     * (tests/vercelTheme.test.ts), because a `primary` added to the layer in
     * good faith would strand the picker: the swatch would move and the screen
     * would not.
     *
     * Layer 3 stays last regardless — it is the operator's word, and it should
     * be the one nothing else can reach over.
     */
    return createTheme(
      deepmerge(
        deepmerge(
          coreTheme(settings, currentMode, 'ltr'),
          vercelTheme(settings.skin as Skin, currentMode)
        ),
        {
          colorSchemes: { light: primaryOverride, dark: darkPrimaryOverride },
          cssVariables: { colorSchemeSelector: 'data' },
          // The operator's typeface, over the stack Monitor's typography sets.
          typography: { fontFamily: FONT_STACK[settings.font ?? 'geist'] }
        }
      )
    )
    // Monitor depends on exactly these three; the rest of `settings` does not
    // reach the theme object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.primaryColor, settings.skin, settings.font, currentMode])

  return (
    <CacheProvider value={emotionCache}>
      <ThemeProvider theme={theme} defaultMode={systemMode} forceThemeRerender>
        <ModeChanger systemMode={systemMode} />
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  )
}
