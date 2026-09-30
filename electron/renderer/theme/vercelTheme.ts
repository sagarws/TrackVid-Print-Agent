/**
 * The Vercel layer.
 *
 * WHAT THIS IS. A theme-shaped object that is deep-merged ON TOP of
 * `@core/theme` in VuexyThemeProvider, and it is the whole of the re-dress:
 * palette, type, corners, edges and the MUI component defaults. Nothing under
 * `@core`, `@menu`, `@layouts` or `configs` is touched, which is the rule in
 * CLAUDE.md — those trees are copies of TrackVid-Monitor and the next copy has
 * to stay a `cp` rather than a merge. This file is escape hatch #1 in that
 * document ("change the theme object we assemble") used at full stretch.
 *
 * WHY IT IS A LAYER AND NOT A REWRITE. Every one of the ~70 screens already
 * asks the theme for its colours — `text.secondary`, `divider`, `primary.main`,
 * `background.paper`. Re-pointing those in one place moves all of them at once,
 * and moves them back just as fast if this is not what was wanted. A screen
 * that still looks wrong after this is a screen holding a hard-coded colour,
 * and that is a bug in the screen, not something to patch here.
 *
 * WHAT VERCEL ACTUALLY LOOKS LIKE, since that is what is being copied:
 *
 *   - Neutral greys. No tint. The ported dark scheme is a blue-violet navy
 *     (#25293C on a '225 222 245' text channel) and that single fact is most of
 *     why the app did not read as Vercel — see MAIN_COLOR_CHANNELS below.
 *   - Borders, not shadows. A card is a 1px line, not a lift. Shadow is spent
 *     only where something genuinely floats: menus, popovers, dialogs.
 *   - One accent, near-black, and colour reserved for status.
 *   - Tight tracking on headings. Geist at -0.02em upward is the house voice.
 *
 * THE OPERATOR'S CHOICES STILL WIN. This merges UNDER the primary-colour
 * override in VuexyThemeProvider, so someone who picks teal in Settings gets
 * teal — they simply get it on Vercel's greys. Keeping the customiser working
 * was a deliberate call; the defaults moved, the controls did not.
 */

// MUI Imports
import { lighten } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'

// Util Imports
import { verticalLayoutClasses } from '@layouts/utils/layoutClasses'

// Type Imports
import type { Skin, SystemMode } from '@core/types'

/**
 * Geist's neutral ramp.
 *
 * WHERE THESE COME FROM, because "exact" was the ask and a design system's
 * greys are not something to reconstruct from memory. The light values below
 * are Vercel's published Geist tokens, cross-checked against two independent
 * published extractions of vercel.com's own production CSS; the ones both
 * agreed on are #171717, #FFFFFF, #FAFAFA, #0070F3 and #4D4D4D.
 *
 * TWO CORRECTIONS FROM THE FIRST PASS, both of which were wrong from memory:
 *
 *   - The hairline is #EBEBEB, not #EAEAEA. #EAEAEA is the old (pre-Geist)
 *     Vercel border and it is the one everybody half-remembers.
 *   - Body text is #171717 over #4D4D4D, not #000000 over #666666. Vercel does
 *     not use pure black for text anywhere; "ink" is #171717.
 *
 * THE DARK RAMP IS NOT FROM THAT SOURCE. The extractions only covered the light
 * theme, so these are Vercel's widely-documented dark values — a true-black
 * page, #0A0A0A panels, #333 edges, #EDEDED text. They are right in substance;
 * if a token file ever becomes available, check them rather than assume.
 */
const GEIST = {
  light: {
    /** The page. `background-100`. */
    bg: '#FFFFFF',
    /** The page, one step down — what cards sit on. `background-200`. */
    bgSubtle: '#FAFAFA',
    /** A raised surface: cards, menus, the navbar. */
    surface: '#FFFFFF',
    /** Hover on a row or a list item. */
    surfaceHover: '#F5F5F5',
    /** THE Vercel hairline. Everything is drawn with this. */
    border: '#EBEBEB',
    /** A border that needs to be seen — a hovered input, a focused edge. */
    borderStrong: '#A1A1A1',
    /** Body text. "Ink" — never pure black. */
    text: '#171717',
    /** Labels, captions, the second line of a card. */
    textSecondary: '#4D4D4D',
    /** Placeholders and disabled text. */
    textTertiary: '#8F8F8F'
  },
  dark: {
    // A true black page with near-black panels lifted off it. Not a navy and
    // not a grey — the #000/#0A0A0A step is the whole depth cue, which is why
    // the border has to carry the shape.
    bg: '#000000',
    bgSubtle: '#0A0A0A',
    surface: '#0A0A0A',
    surfaceHover: '#1A1A1A',
    border: '#333333',
    borderStrong: '#4D4D4D',
    text: '#EDEDED',
    textSecondary: '#A1A1A1',
    textTertiary: '#7A7A7A'
  }
} as const

/**
 * Status colours.
 *
 * `main` and `dark` are Vercel's own tokens where a source confirmed one:
 * #EE0000/#C50000 for error, #F5A623/#AB570A for warning, #0070F3/#0761D1 for
 * info. `light` is COMPUTED with MUI's `lighten` rather than written down,
 * because inventing a plausible hex and presenting it as a Geist token is the
 * failure mode this whole comment exists to avoid.
 *
 * SUCCESS IS THE ONE UNCONFIRMED VALUE. No public extraction covered Vercel's
 * green, and the historical Geist UI actually shipped BLUE as its success
 * colour — which is why a green here cannot be inferred from the rest of the
 * scale. #45A557 matches the green on a "Ready" badge closely; treat it as the
 * considered choice it is rather than as a quoted token.
 */
const STATUS_SEED = {
  error: { main: '#EE0000', dark: '#C50000' },
  warning: { main: '#F5A623', dark: '#AB570A' },
  info: { main: '#0070F3', dark: '#0761D1' },
  success: { main: '#45A557', dark: '#2F7A3D' }
} as const

type StatusKey = keyof typeof STATUS_SEED

/**
 * The seeds, resolved for one scheme.
 *
 * On black every one of them is lifted: a #EE0000 on #000 vibrates badly, and
 * Vercel's dark palette raises its accents for exactly that reason.
 */
const statusFor = (mode: 'light' | 'dark') =>
  (Object.keys(STATUS_SEED) as StatusKey[]).reduce<
    Record<string, { main: string; light: string; dark: string; contrastText: string }>
  >((acc, key) => {
    const seed = STATUS_SEED[key]
    const main = mode === 'light' ? seed.main : lighten(seed.main, 0.25)

    acc[key] = {
      main,
      light: lighten(main, 0.25),
      dark: mode === 'light' ? seed.dark : seed.main,
      contrastText: '#FFFFFF'
    }

    return acc
  }, {})

/**
 * The text/divider/action channel, neutralised.
 *
 * THIS IS THE SINGLE HIGHEST-LEVERAGE LINE IN THE FILE. The ported theme builds
 * `text.primary`, `text.secondary`, `divider` and every `action.*` state as an
 * opacity on these channels, and ships them as '47 43 61' (a violet-black) and
 * '225 222 245' (a violet-white). Every grey in the app inherits that tint.
 * Setting them neutral re-points several hundred derived colours at once —
 * which is exactly the leverage this file exists to get.
 */
const MAIN_COLOR_CHANNELS = {
  light: '0 0 0',
  dark: '255 255 255',
  lightShadow: '0 0 0',
  darkShadow: '0 0 0'
} as const

/**
 * Vercel's corners. Small and consistent: 6px on a control, 8px on something
 * that floats, 12px on a card. Nothing in their UI is a pill except a status
 * badge and an avatar.
 */
const RADIUS = { xs: 2, sm: 4, md: 6, lg: 8, xl: 12 } as const

/**
 * One row of a dropdown — an Autocomplete option or a menu item. 32px tall at
 * 13px, the table's size, with the gap an option's leading icon sits at.
 */
const DROPDOWN_ROW = {
  // Physical, not logical: MUI sets `min-height` on a menu item, and a
  // logical declaration does not displace it.
  minHeight: 32,
  paddingBlock: 6,
  paddingInline: 8,
  gap: 8,
  borderRadius: RADIUS.sm,
  fontSize: '0.8125rem',
  lineHeight: 1.4,
  color: 'var(--mui-palette-text-primary)'
} as const

/**
 * Tabler's `check`, as a mask — the path `.tabler-check` carries in
 * styles/icons.css. A mask, not a colour: it is painted in currentColor, so it
 * follows the scheme like any other icon.
 */
const CHECK_MASK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='m5 12l5 5L20 7'/%3E%3C/svg%3E\")"

/**
 * The chip colours that mean something and must therefore stay tinted.
 *
 * `secondary` is NOT here on purpose: a tonal-secondary chip is the app's
 * neutral badge and its unselected filter, and both of those are drawn as a
 * white pill on a hairline instead — see the MuiChip override.
 */
const TINTED_TONES = ['primary', 'info', 'success', 'warning', 'error'] as const

type TintedTone = (typeof TINTED_TONES)[number]

/**
 * NOTHING CASTS A SHADOW.
 *
 * Vercel's surfaces are separated by a 1px line, not by a lift, and a shadow
 * under a bordered card is the single clearest tell that a theme is a template
 * wearing a new palette. Both ramps are therefore flat.
 *
 * THERE ARE TWO RAMPS AND MISSING THE SECOND IS WHY THE FIRST PASS STILL HAD
 * SHADOWS. `shadows` is MUI's own 25-step array. `customShadows` is the ported
 * theme's extra key, and it is the one the SHELL reads — `@layouts`'
 * StyledHeader sets `box-shadow: var(--mui-customShadows-sm)` directly, and
 * styles/vuexy.css re-exports the whole ramp as Tailwind's `--shadow-*`, so
 * every `shadow-sm` class in the app resolves through it too. Zeroing only the
 * MUI array leaves the navbar, the footer and every Tailwind shadow utility
 * exactly as they were.
 *
 * The one exception is deliberate and is NOT applied here: a menu, a popover
 * and a dialog genuinely float over the page rather than sitting in it, and
 * Vercel does give those a soft shadow. Those three get theirs on the component
 * itself, further down, so that everything else can be unconditionally flat.
 */
/** One row height for every data table, header included. Exported for tests. */
export const TABLE_ROW_BLOCK_SIZE = 40

/** A small input, the same height MUI gives a small button. */
export const CONTROL_BLOCK_SIZE_SM = 32

/** Space between the page's edge and its content, on every screen. */
export const PAGE_GUTTER = 16

const FLAT_RAMP: string[] = ['none', ...Array<string>(24).fill('none')]

/** The overlay shadow, for the three things that actually float. */
const OVERLAY_SHADOW = (mode: SystemMode) =>
  mode === 'dark'
    ? '0px 8px 24px rgba(0, 0, 0, 0.80)'
    : '0px 8px 24px rgba(0, 0, 0, 0.12)'

/**
 * The ported theme's extra shadow key, flattened.
 *
 * Every entry has to be present and has to be 'none': a missing one resolves to
 * an undefined CSS variable, and `box-shadow: var(--mui-customShadows-sm)` with
 * nothing behind it is an invalid declaration rather than no shadow — which
 * means the browser keeps whatever it inherited.
 */
const NO_TONE_SHADOW = { sm: 'none', md: 'none', lg: 'none' } as const

const FLAT_CUSTOM_SHADOWS = {
  xs: 'none',
  sm: 'none',
  md: 'none',
  lg: 'none',
  xl: 'none',
  // Spelled out rather than generated: a mapped/`fromEntries` build widens the
  // key type to `string`, which loses the very thing worth checking — that
  // every tone the ported theme can ask for is actually present.
  primary: NO_TONE_SHADOW,
  secondary: NO_TONE_SHADOW,
  error: NO_TONE_SHADOW,
  warning: NO_TONE_SHADOW,
  info: NO_TONE_SHADOW,
  success: NO_TONE_SHADOW
}

/** One scheme's palette overrides. */
const paletteFor = (mode: 'light' | 'dark', skin: Skin) => {
  const c = GEIST[mode]
  const status = statusFor(mode)

  return {
    palette: {
      ...status,
      // Grey, spelled out so a component reaching for `grey.500` lands on a
      // Vercel grey rather than MUI's default blue-grey.
      secondary: {
        main: c.textSecondary,
        light: c.textTertiary,
        dark: mode === 'light' ? '#444444' : '#C9C9C9',
        contrastText: mode === 'light' ? '#FFFFFF' : '#000000'
      },
      text: {
        primary: c.text,
        secondary: c.textSecondary,
        disabled: c.textTertiary
      },
      divider: c.border,
      background: {
        // `bordered` is the skin that draws a line around everything instead of
        // floating it; on Vercel's palette that means the page goes flat white
        // (or flat black) and the border does the work.
        default: skin === 'bordered' ? c.bg : c.bgSubtle,
        paper: c.surface
      },
      action: {
        hover: mode === 'light' ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.06)',
        selected: mode === 'light' ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.09)',
        focus: mode === 'light' ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.12)'
      },
      // The ported theme's own extras. Left in step with the above so the
      // screens that read them do not become the one tinted thing on screen.
      customColors: {
        bodyBg: skin === 'bordered' ? c.bg : c.bgSubtle,
        chatBg: c.bgSubtle,
        greyLightBg: c.bgSubtle,
        /*
         * THE HAIRLINE, not the strong border.
         *
         * This was `borderStrong` (#A1A1A1), which several ported components
         * use for an input's RESTING edge — so every field sat in a border
         * roughly six times darker than the #EBEBEB every card, dropzone and
         * table row wears, and the form read as a grid of heavy boxes. Vercel
         * draws an input with the same hairline as everything else and darkens
         * it only on hover and focus, which is what the component overrides
         * below now do.
         */
        inputBorder: c.border,
        tableHeaderBg: c.bgSubtle,
        tooltipText: mode === 'light' ? '#FFFFFF' : '#000000',
        trackBg: c.surfaceHover
      },
      Avatar: { defaultBg: c.surfaceHover },
      Chip: { defaultBorder: c.border },
      FilledInput: {
        bg: c.bgSubtle,
        hoverBg: c.surfaceHover,
        disabledBg: c.bgSubtle
      },
      SnackbarContent: {
        bg: mode === 'light' ? '#000000' : '#EDEDED',
        color: mode === 'light' ? '#FFFFFF' : '#000000'
      },
      Tooltip: { bg: mode === 'light' ? '#000000' : '#EDEDED' }
    }
  }
}

/**
 * The layer itself.
 *
 * @param skin  The operator's skin — `bordered` flattens the page background.
 * @param mode  Which scheme is live, for the shadow ramp (which is not a
 *              colour-scheme value in MUI and so cannot vary by scheme).
 */
const vercelTheme = (skin: Skin, mode: SystemMode) => ({
  colorSchemes: {
    light: paletteFor('light', skin),
    dark: paletteFor('dark', skin)
  },

  mainColorChannels: MAIN_COLOR_CHANNELS,

  shape: {
    borderRadius: RADIUS.md,
    customBorderRadius: RADIUS
  },

  shadows: FLAT_RAMP,

  customShadows: FLAT_CUSTOM_SHADOWS,

  /*
   * ONE TYPE SCALE: 12 / 13 / 14 / 16 / 18 / 20 / 24 / 30 / 36.
   *
   * THE APP HAD THREE, and that is the whole of the "font sizes don't match"
   * problem. They disagreed by one or two pixels, which is the worst possible
   * margin — too small to look deliberate, too large to look right:
   *
   *   MUI variants   body1 15px, body2 13px, h6 15px   (the ported scale,
   *                  pitched off a 13.125px base)
   *   Tailwind       text-sm 14px, text-xs 12px        (233 usages)
   *   Hard-coded     10, 11, 12, 13, 14, 16, 17, 18, 20, 22, 26, 30, 32, 40
   *
   * So a field label written `text-sm` (14) sat beside a <Typography> body1
   * (15) beside an `sx={{ fontSize: 13 }}` — three sizes for one role.
   *
   * THE TAILWIND SCALE WINS, and the MUI variants are moved onto it. That
   * direction is deliberate: Tailwind's steps are already 12/14/16/18/20/24/30,
   * they already match Vercel's, and there are 233 of them against far fewer
   * Typography variants — so this is the alignment that touches least while
   * fixing most. The steps are declared in styles/theme.css and are unchanged.
   *
   * THE ROLES, in the app's own words:
   *
   *   caption / overline  12px  meta, counts, timestamps, helper text
   *   body2 / subtitle2   13px  descriptions, dense table cells, secondary
   *   body1 / subtitle1   14px  MAIN TEXT — the default for anything readable
   *   h6                  16px  a card's or a section's title
   *   h5                  18px  a sub-heading inside a page
   *   h4                  20px  the page title
   *   h3/h2/h1        24/30/36  bigger headings; rare in this app
   *
   * `typography.fontSize` (13.125) is deliberately NOT touched: MUI derives
   * `pxToRem` from it, so moving it would rescale ported components that size
   * themselves that way — a much wider blast radius than the variants.
   */
  typography: {
    fontWeightMedium: 500,
    h1: { fontSize: '2.25rem', fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.045em' },
    h2: { fontSize: '1.875rem', fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.04em' },
    h3: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.035em' },
    h4: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.4, letterSpacing: '-0.03em' },
    h5: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.45, letterSpacing: '-0.025em' },
    h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.5, letterSpacing: '-0.02em' },
    subtitle1: { fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.5, letterSpacing: '-0.011em' },
    subtitle2: { fontSize: '0.8125rem', fontWeight: 500, lineHeight: 1.5, letterSpacing: '-0.006em' },
    body1: { fontSize: '0.875rem', lineHeight: 1.5, letterSpacing: '-0.011em' },
    body2: { fontSize: '0.8125rem', lineHeight: 1.5, letterSpacing: '-0.006em' },
    button: {
      fontSize: '0.875rem',
      fontWeight: 500,
      lineHeight: 1.5,
      letterSpacing: '-0.011em',
      textTransform: 'none' as const
    },
    caption: { fontSize: '0.75rem', lineHeight: 1.5, letterSpacing: '0' },
    overline: {
      fontSize: '0.75rem',
      fontWeight: 500,
      lineHeight: 1.5,
      letterSpacing: '0.02em',
      textTransform: 'none' as const
    }
  },

  components: {
    /*
     * Geist is a geometric grotesque and it is drawn for antialiased rendering.
     * Without these two lines it renders noticeably heavier on macOS than the
     * same screen does on vercel.com, which is the kind of difference that
     * reads as "close but wrong".
     */
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale'
        },

        /*
         * The overlay shadow, published as a variable.
         *
         * Menus, popovers and dialogs get theirs from OVERLAY_SHADOW directly,
         * but a toast is rendered from a plain component outside MUI — and
         * with `customShadows` flat, its `shadow-lg` now resolves to `none`.
         * Rather than write a second rgba somewhere else and let the two drift,
         * the one value is exposed here for anything that genuinely floats.
         */
        ':root': {
          '--trackvid-overlay-shadow': OVERLAY_SHADOW(mode)
        },


        /*
         * THE NAVBAR'S EDGE lives with the rest of the bar's shape, in
         * layout/navbarStyles.ts: the floating card is gone, and the strip that
         * replaced it draws its own hairline along the bottom.
         */

        /*
         * The same boundary for the two non-floating arrangements, which use a
         * shadow that appears on scroll rather than a permanent one. If the
         * navbar config is ever changed, these keep it from losing its edge the
         * same way the floating one did.
         */
        [`.${verticalLayoutClasses.headerAttached}.scrolled, .${verticalLayoutClasses.headerDetached}.scrolled .${verticalLayoutClasses.navbar}`]:
          {
            borderBlockEnd: '1px solid var(--mui-palette-divider)'
          },

        /*
         * A FOCUSED FIELD IS 1px, NOT 2px.
         *
         * `@core/components/mui/TextField.tsx` — the ported input every form on
         * this app uses — sets `borderWidth: 2` on `.Mui-focused`. That is a
         * styled() wrapper, so it out-specifies any `MuiInputBase` override in
         * this theme, and it is vendored so it cannot be edited. The result was
         * the one focused field on Create Claim wearing a border twice the
         * weight of everything around it.
         *
         * Focus is carried by COLOUR here instead: the outlined-input override
         * above takes the edge to `text.primary` on focus, and a near-black
         * hairline against #EBEBEB neighbours is unmistakable without changing
         * the box's weight — which is also why nothing shifts by a pixel when a
         * field gains focus.
         *
         * `!important` is the only thing that beats a styled() rule from out
         * here; specificity alone cannot.
         */
        '.MuiInputBase-root.Mui-focused': {
          borderWidth: '1px !important'
        },

        /*
         * AN INPUT IS MAIN TEXT — 14px, like everything else you can read.
         *
         * `@core/components/mui/TextField.tsx` pitches every medium-size input
         * at `fontSize: '17px'`, which is not on any scale in this app: it is
         * three pixels above main text and four above the dense text beside it.
         * On Manage Claims that made the search placeholder the largest string
         * on a screen otherwise built from 13s and 14s.
         *
         * Vendored and set from a styled() wrapper, so `!important` is the only
         * thing that reaches it.
         */
        '.MuiInputBase-root:not(.MuiInputBase-sizeSmall)': {
          fontSize: '0.875rem !important'
        },

        /*
         * A SMALL FIELD IS THE SAME BOX AS A SMALL BUTTON.
         *
         * The ported small field comes out 37px tall with 14px text, beside
         * small buttons that are 32px with 13px text. In a toolbar — search,
         * dates, actions in one row — that made the search box the one control
         * that did not line up, and its placeholder the one string a size up.
         *
         * Fixed on the ROOT's height rather than by tuning padding: the field
         * then cannot drift when its font or line-height does. Multiline is
         * excluded because a textarea grows by design.
         */
        '.MuiInputBase-root.MuiInputBase-sizeSmall:not(.MuiInputBase-multiline)': {
          fontSize: '0.8125rem !important',
          blockSize: `${CONTROL_BLOCK_SIZE_SM}px`
        },
        '.MuiInputBase-root.MuiInputBase-sizeSmall:not(.MuiInputBase-multiline) .MuiInputBase-input': {
          paddingBlock: '0 !important'
        },

        /*
         * THE PAGE GUTTER. The shell pads the page 24px on every side, and the
         * bar's content is inset to match. On a screen built from full-width
         * cards — Manage Claims above all — that left a wide band of empty
         * page round every card. 16px on every screen, so no screen drifts;
         * layout/navbarStyles.ts insets the bar's content by the same amount.
         */
        [`.${verticalLayoutClasses.content}`]: {
          padding: `${PAGE_GUTTER}px !important`
        },

        /*
         * A TABLE IS ONE SIZE, HEADER AND BODY.
         *
         * `@core/styles/table.module.css` declares the table at 0.8125rem and
         * its headers at 0.8125rem — then sets `tbody th, td` to 0.9375rem.
         * So every value sat two pixels above the column heading above it and
         * the chips beside it, which is what makes a claims table look ragged
         * even though nothing in it is obviously wrong.
         *
         * 13px for both: this is dense tabular data, the `body2` role, and it
         * is what the stylesheet's own root declaration already says the table
         * is. The 0.9375rem on tbody was the outlier, not the rule.
         *
         * A CSS Module class beats a bare element selector, so `!important`
         * again. Scoped to `tbody` so a nested layout table is not caught.
         */
        'table tbody th, table tbody td': {
          fontSize: '0.8125rem !important',
          blockSize: `${TABLE_ROW_BLOCK_SIZE}px !important`,
          // No vertical padding: the row height is the cell height. MUI's
          // checkbox is 38px with its touch ring, so any padding here pushed
          // every row with a tick box past 40.
          paddingBlock: '0 !important'
        },

        /*
         * AND ONE HEIGHT, HEADER AND BODY.
         *
         * The ported stylesheet makes a header cell 56px and a body cell 50px,
         * with the header in uppercase, letter-spaced 13px — the Vuexy header.
         * So the header was taller than the rows it labels and shouted over
         * them. Vercel's header is a quiet grey label row the same height as a
         * row of data: sentence case, 13px, medium weight, the secondary grey.
         *
         * 40px for both. It is the smallest height that still takes a small
         * icon button or a status chip with room around it, and it is what
         * makes a page of 25 claims fit a normal window.
         */
        'table thead th': {
          blockSize: `${TABLE_ROW_BLOCK_SIZE}px !important`,
          paddingBlock: '0 !important',
          fontSize: '0.8125rem !important',
          fontWeight: '500 !important',
          lineHeight: '1.5 !important',
          letterSpacing: 'normal !important',
          textTransform: 'none',
          color: 'var(--mui-palette-text-secondary) !important',
          // !important so a pinned header cell, which paints its own opaque
          // background (styles/table-chrome.css), is the same grey as the rest
          // of the row rather than a white block at its start.
          backgroundColor: 'var(--mui-palette-customColors-tableHeaderBg) !important'
        },
        'table thead': { textTransform: 'none !important' }
      }
    },

    // A surface is a border. Elevation is opt-in, not the default.
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: { borderColor: 'var(--mui-palette-divider)' }
      }
    },

    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: '1px solid var(--mui-palette-divider)',
          borderRadius: RADIUS.xl,
          backgroundImage: 'none',
          boxShadow: 'none'
        }
      }
    },

    MuiCardHeader: {
      styleOverrides: {
        // Vercel's card headers are quiet: the title is the only thing at full
        // weight, and the subheader is the grey that every second line uses.
        // 16px — the h6 step, which is the 'card or section title' role.
        title: { fontSize: '1rem', fontWeight: 600, letterSpacing: '-0.02em' },
        subheader: { fontSize: '0.8125rem', color: 'var(--mui-palette-text-secondary)' }
      }
    },

    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        /*
         * A FUNCTION, because the fix depends on the variant.
         *
         * Vercel has exactly two buttons: a black fill for the one action that
         * matters, and a WHITE BUTTON WITH A HAIRLINE BORDER for everything
         * else. It has no tinted-fill button at all.
         *
         * The ported theme's "tonal" secondary is that tinted fill — a wash of
         * `secondary.lightOpacity` at 16% with no border. On Vuexy's mid-grey
         * secondary that read as a button. Against Geist's near-white surfaces
         * it washes out to almost nothing, which is why Bulk Claim, Reset and
         * Save looked like plain text sitting next to a real button. Roughly
         * thirty call sites use it, through `components/ui/Button`'s
         * `secondary` variant, so fixing the variant here fixes all of them at
         * once rather than screen by screen.
         *
         * `!important` IS REQUIRED and is not laziness. The tonal fill is
         * declared in `@core/theme/overrides/button.ts` as a `variants` entry,
         * and MUI applies `variants` AFTER `styleOverrides.root` — so an
         * ordinary declaration here loses to it no matter how this is written.
         * The border is not fought over (core sets none) but is kept in the
         * same block so the whole button reads from one place.
         */
        root: ({
          ownerState
        }: {
          // Only the two props this branch reads. MUI's own ButtonProps does not
          // know about `tonal`, which the ported theme adds.
          ownerState?: { variant?: string; color?: string }
        }) => ({
          borderRadius: RADIUS.md,
          textTransform: 'none',
          fontWeight: 500,
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none' },
          '&:active': { boxShadow: 'none' },

          ...(ownerState?.variant === 'tonal' &&
            ownerState?.color === 'secondary' && {
              backgroundColor: 'var(--mui-palette-background-paper) !important',
              color: 'var(--mui-palette-text-primary) !important',
              border: '1px solid var(--mui-palette-divider)',
              '&:hover': {
                backgroundColor: 'var(--mui-palette-customColors-trackBg) !important',
                borderColor: 'var(--mui-palette-text-disabled)',
                boxShadow: 'none'
              },
              '&.Mui-disabled': {
                color: 'var(--mui-palette-text-disabled) !important',
                borderColor: 'var(--mui-palette-divider)'
              }
            })
        }),
        // Vercel's primary button inverts rather than tints: black on white,
        // white on black, and it LIGHTENS on hover because there is nowhere
        // darker for near-black to go.
        contained: {
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none' }
        },
        outlined: {
          borderColor: 'var(--mui-palette-divider)',
          '&:hover': {
            borderColor: 'var(--mui-palette-text-disabled)',
            backgroundColor: 'var(--mui-palette-action-hover)'
          }
        },

        /*
         * 16px, not the ported 1.0625rem.
         *
         * `sizeSmall` correctly follows `body2`, but `sizeLarge` was pinned at
         * 17px — a step that exists nowhere else in the app. 1rem is the h6
         * step, one above main text, which is what a large button should be.
         */
        sizeLarge: { fontSize: '1rem' },

        /*
         * EVERY SMALL BUTTON IS ONE HEIGHT — the small field's.
         *
         * The ported theme pads each variant differently, so a small
         * contained button (the page's one action) came out 26px beside 32px
         * outlined ones: "Create Ticket" sat 6px shorter than the toolbar it
         * ends, and every dialog's primary button was shorter than its Cancel.
         * Pinned here rather than per variant so a new variant cannot drift.
         *
         * THIS KEY REPLACES THE PORTED ONE rather than merging with it — the
         * ported `sizeSmall` is a function, and a deep merge swaps a function
         * for an object outright. So its three declarations are restated here:
         * without them a small button's text jumped to 14px and it measured 35.
         */
        sizeSmall: {
          fontSize: '0.8125rem',
          lineHeight: 1.38462,
          borderRadius: 'var(--mui-shape-customBorderRadius-sm)',
          minBlockSize: `${CONTROL_BLOCK_SIZE_SM}px`,
          boxSizing: 'border-box'
        }
      }
    },

    MuiIconButton: {
      styleOverrides: { root: { borderRadius: RADIUS.md } }
    },

    /*
     * COUNT BADGES — a small pill that sits on the icon's corner.
     *
     * The ported `standard` badge is a 24px pill at 15px type: bigger than the
     * 20px glyph it annotates, so on the notification bell it covered the bell
     * instead of marking it. Vercel's count is a 16px pill at 11px, ringed in
     * the surface colour so it separates from the stroke beneath it.
     *
     * Restated in full: the ported `standard` is a function, and a deep merge
     * replaces a function with an object outright.
     */
    MuiBadge: {
      styleOverrides: {
        standard: {
          height: 16,
          minWidth: 16,
          padding: '0 4px',
          borderRadius: 8,
          fontSize: '0.6875rem',
          fontWeight: 600,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          boxShadow: '0 0 0 2px var(--mui-palette-background-paper)'
        }
      }
    },

    MuiToggleButton: {
      styleOverrides: {
        root: { borderRadius: RADIUS.md, textTransform: 'none', fontWeight: 500 }
      }
    },

    // Inputs: a 1px line that goes near-black on focus. No glow, no fill.
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: RADIUS.md,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'var(--mui-palette-divider)'
          },
          '&:hover:not(.Mui-disabled):not(.Mui-error) .MuiOutlinedInput-notchedOutline': {
            // text.disabled is the mid-grey in the palette — #8F8F8F light,
            // #7A7A7A dark. Enough to register as hover without becoming the
            // heavy resting border this just moved away from.
            borderColor: 'var(--mui-palette-text-disabled)'
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderWidth: 1,
            borderColor: 'var(--mui-palette-text-primary)'
          }
        }
      }
    },

    MuiFilledInput: {
      styleOverrides: {
        root: {
          borderRadius: RADIUS.md,
          border: '1px solid var(--mui-palette-divider)',
          '&:before, &:after': { display: 'none' }
        }
      }
    },

    /*
     * FILTER CHIPS — the claim queue's primary navigation.
     *
     * ClaimsPage and JobsPage both express a filter as
     * `variant={active ? 'filled' : 'tonal'} color={active ? 'primary' : 'secondary'}`,
     * which is why this belongs here rather than on either screen: the two
     * have to read identically, and the comment on ClaimsPage's Tab says so.
     *
     * WHAT WAS WRONG. `filled primary` paints the chip in the primary colour.
     * That was a violet accent in the template; it is a near-black now, so the
     * selected filter became a black slab — and on Manage Claims there are
     * twenty-one of these across two rows, so the one selected tab dominated
     * the screen. It is the same mistake the sidebar's active item had.
     *
     * WHAT THEY ARE NOW. Vercel's pattern for a filter that is also a state:
     * every chip is a white pill on a hairline, and the selected one is filled
     * with the same quiet grey the active nav item uses, outlined in ink and
     * set a weight heavier. Selection reads instantly without anything on the
     * screen being black.
     *
     * `!important` for the same reason as the button: these colours come from
     * `variants` entries in @core/theme/overrides/chip.ts, and MUI applies
     * variants after styleOverrides.root.
     */
    MuiChip: {
      styleOverrides: {
        // 13px, like the table and the buttons beside it. The ported small chip
        // lands at 12.19px, a size used nowhere else.
        sizeSmall: { fontSize: '0.8125rem !important' },
        labelSmall: { fontSize: 'inherit' },
        root: ({
          ownerState
        }: {
          ownerState?: { variant?: string; color?: string }
        }) => ({
          borderRadius: RADIUS.md,
          fontWeight: 500,

          ...(ownerState?.variant === 'tonal' &&
            ownerState?.color === 'secondary' && {
              backgroundColor: 'var(--mui-palette-background-paper) !important',
              color: 'var(--mui-palette-text-secondary) !important',
              border: '1px solid var(--mui-palette-divider)',
              '&:hover': {
                backgroundColor: 'var(--mui-palette-action-hover) !important',
                borderColor: 'var(--mui-palette-text-disabled)'
              }
            }),

          ...(ownerState?.variant === 'filled' &&
            ownerState?.color === 'primary' && {
              backgroundColor: 'var(--mui-palette-action-selected) !important',
              color: 'var(--mui-palette-text-primary) !important',
              border: '1px solid var(--mui-palette-text-primary)',
              fontWeight: 500,
              '&:hover': {
                backgroundColor: 'var(--mui-palette-action-selected) !important'
              }
            }),

          /*
           * STATUS PILLS — every "In Review", "Success", "Saved", "Expired" in
           * the app.
           *
           * THEY WERE RENDERING SOLID. `Badge` asks for `variant='tonal'`, and
           * tonal is a custom variant the ported theme adds through a
           * `variants` entry — but MUI only knows 'filled' and 'outlined', so
           * its BASE filled style lands first and paints the chip in
           * `<colour>.main` with white `contrastText`. A table of saturated
           * blue and green lozenges is the result, and it long predates the
           * re-dress; the Dashboard's Saved/Expired badges did the same.
           *
           * Vercel's badge is a quiet tint of the hue with the hue itself as
           * the text — the colour still carries the meaning, at a fraction of
           * the weight, which matters when ninety rows each carry two of them.
           *
           * Declared explicitly here rather than left to the ported variant so
           * the base filled style cannot win: that is what `!important` is for.
           */
          ...(ownerState?.variant === 'tonal' &&
            ownerState?.color !== undefined &&
            TINTED_TONES.includes(ownerState.color as TintedTone) && {
              backgroundColor: `var(--mui-palette-${ownerState.color}-lightOpacity) !important`,
              /*
               * THE DARKER HUE, not `main`, and this is a contrast fix rather
               * than a preference. `main` on its own 16% tint measures about
               * 3.6:1 — under the 4.5:1 WCAG asks for at the size these labels
               * are set. The `dark` step on the same tint clears it.
               */
              color: `var(--mui-palette-${ownerState.color}-dark) !important`,
              border: 'none',
              fontWeight: 500,
              /*
               * Inverted on the dark scheme: there `dark` is the deepest step
               * of the hue and would sink into the tint it sits on, so the
               * lightened one carries the label instead. The selector is MUI's
               * own, because the theme sets `colorSchemeSelector: 'data'`.
               */
              '[data-mui-color-scheme="dark"] &': {
                color: `var(--mui-palette-${ownerState.color}-light) !important`
              }
            })
        }),
        outlined: { borderColor: 'var(--mui-palette-divider)' }
      }
    },

    // Floating things are where the shadow budget goes.
    MuiMenu: {
      styleOverrides: {
        // The same 4px inset as a dropdown's listbox, so a selected row sits
        // inside the panel rather than running into its edge.
        list: { padding: 4 },
        paper: {
          borderRadius: RADIUS.lg,
          border: '1px solid var(--mui-palette-divider)',
          // One of the three things that genuinely floats. See FLAT_RAMP.
          boxShadow: OVERLAY_SHADOW(mode)
        }
      }
    },

    MuiPopover: {
      styleOverrides: {
        paper: {
          borderRadius: RADIUS.lg,
          border: '1px solid var(--mui-palette-divider)',
          // One of the three things that genuinely floats. See FLAT_RAMP.
          boxShadow: OVERLAY_SHADOW(mode)
        }
      }
    },

    /*
     * MENU ITEMS — every `TextField select` and every action menu.
     *
     * The ported `root` is a function, and a deep merge replaces a function
     * with an object, so everything it did is restated: until now a selected
     * item fell through to MUI's own primary-tinted fill. Same row, same
     * states as a dropdown option below, so a Select and an Autocomplete on
     * one form cannot be told apart by their menus.
     */
    MuiMenuItem: {
      styleOverrides: {
        root: ({ theme }: { theme: Theme }) => ({
          ...DROPDOWN_ROW,
          // MUI resets a menu item to `min-height: auto` from `sm` up, in a
          // media query emitted after the row above — so it is restated there.
          [theme.breakpoints.up('sm')]: { minHeight: DROPDOWN_ROW.minHeight },
          '&:hover, &.Mui-focusVisible': { backgroundColor: 'var(--mui-palette-action-hover)' },
          '&.Mui-selected, &.Mui-selected:hover, &.Mui-selected.Mui-focusVisible': {
            backgroundColor: 'var(--mui-palette-action-selected)',
            fontWeight: 500
          },
          '&.Mui-disabled': { opacity: 0.45 },
          '& .MuiListItemIcon-root': { minInlineSize: 0 }
        })
      }
    },

    /*
     * DROPDOWNS — every Autocomplete in the app, most of them on Create Claim.
     *
     * WHAT WAS WRONG. An Autocomplete's list is a Paper in a Popper, not a
     * Popover, so none of the floating treatment above reached it: it drew
     * with the flattened shadow and no edge, and melted into the page behind
     * it. Its selected row was the ported primary tint, which with a
     * near-black primary is a mid-grey slab heavier than anything else on the
     * form. Rows were 15px text with 8px side margins, a size nothing else in
     * the app uses.
     *
     * WHAT THEY ARE NOW. Vercel's select: a hairline-edged, shadowed panel 4px
     * below the field; 32px rows at 13px like the table and the menus; a grey
     * wash on hover; and the chosen row marked by a check at its end and a
     * heavier weight, not a fill — so the row under the pointer and the row
     * that is chosen never look alike.
     *
     * The check is a mask of Tabler's own `check` glyph (the same path as
     * `.tabler-check` in styles/icons.css), painted in currentColor. It has to
     * be a pseudo-element: an option's markup belongs to whichever call site
     * rendered it, and a dozen of them would otherwise each need to add one.
     *
     * The ported `listbox` is a function, so it is replaced here, not merged.
     */
    MuiAutocomplete: {
      styleOverrides: {
        paper: {
          marginBlockStart: 4,
          borderRadius: RADIUS.lg,
          border: '1px solid var(--mui-palette-divider)',
          backgroundImage: 'none',
          // One of the three things that genuinely floats. See FLAT_RAMP.
          boxShadow: OVERLAY_SHADOW(mode)
        },
        listbox: {
          padding: 4,
          maxHeight: 320,
          '& .MuiAutocomplete-option': {
            ...DROPDOWN_ROW,
            margin: 0,
            '&.Mui-focused, &.Mui-focusVisible': {
              backgroundColor: 'var(--mui-palette-action-hover)'
            },
            '&[aria-selected="true"]': {
                backgroundColor: 'transparent',
                color: 'var(--mui-palette-text-primary)',
                fontWeight: 500,
                '&::after': {
                  content: '""',
                  flexShrink: 0,
                  marginInlineStart: 'auto',
                  inlineSize: 16,
                  blockSize: 16,
                  backgroundColor: 'currentColor',
                  WebkitMaskImage: CHECK_MASK,
                  maskImage: CHECK_MASK,
                  WebkitMaskSize: '100% 100%',
                  maskSize: '100% 100%'
                }
              },
            '&[aria-selected="true"].Mui-focused': {
              backgroundColor: 'var(--mui-palette-action-hover)'
            },
            '&[aria-disabled="true"]': { opacity: 0.45 }
          }
        },
        noOptions: {
          fontSize: '0.8125rem',
          color: 'var(--mui-palette-text-secondary)',
          padding: '8px 12px'
        },
        loading: {
          fontSize: '0.8125rem',
          color: 'var(--mui-palette-text-secondary)',
          padding: '8px 12px'
        },
        groupLabel: {
          fontSize: '0.75rem',
          fontWeight: 500,
          lineHeight: '28px',
          color: 'var(--mui-palette-text-secondary)',
          backgroundColor: 'var(--mui-palette-background-paper)'
        },
        // The field selects its own text when focused, so typing replaces the
        // choice. The browser's blue for that selection is the one saturated
        // colour on the form; the neutral wash says the same thing.
        input: {
          '&::selection': { backgroundColor: 'var(--mui-palette-action-selected)' }
        }
      }
    },

    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: RADIUS.xl,
          border: '1px solid var(--mui-palette-divider)',
          backgroundImage: 'none',
          // One of the three things that genuinely floats. See FLAT_RAMP.
          boxShadow: OVERLAY_SHADOW(mode)
        }
      }
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          borderRadius: RADIUS.md,
          fontSize: '0.75rem',
          fontWeight: 500,
          padding: '6px 10px'
        }
      }
    },

    /*
     * Tables. Vercel's are lines and quiet headers — a grey label row at the
     * same size as the body, NOT the uppercase letterspaced header the ported
     * theme draws, which is the single most template-looking thing on a data
     * screen.
     */
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: '1px solid var(--mui-palette-divider)' },
        head: {
          fontSize: '0.8125rem',
          fontWeight: 500,
          textTransform: 'none',
          letterSpacing: '-0.006em',
          color: 'var(--mui-palette-text-secondary)',
          backgroundColor: 'var(--mui-palette-customColors-tableHeaderBg)'
        }
      }
    },

    MuiTabs: {
      styleOverrides: {
        indicator: { backgroundColor: 'var(--mui-palette-text-primary)', height: 2 }
      }
    },

    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
          minHeight: 40,
          color: 'var(--mui-palette-text-secondary)',
          '&.Mui-selected': { color: 'var(--mui-palette-text-primary)' }
        }
      }
    },

    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: RADIUS.lg,
          border: '1px solid var(--mui-palette-divider)',
          // 13px, the size of the page it sits on. At MUI's default 14px every
          // warning was the one line a size up from the table under it.
          fontSize: '0.8125rem'
        }
      }
    },

    MuiDivider: {
      styleOverrides: { root: { borderColor: 'var(--mui-palette-divider)' } }
    },

    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: RADIUS.xs, height: 6 },
        bar: { borderRadius: RADIUS.xs }
      }
    },

    MuiAvatar: {
      styleOverrides: { root: { fontSize: '0.8125rem', fontWeight: 500 } }
    },

    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: RADIUS.md } }
    }
  }
})

export default vercelTheme
