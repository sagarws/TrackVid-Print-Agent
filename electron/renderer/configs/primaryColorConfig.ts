export type PrimaryColorConfig = {
  name?: string
  light?: string
  main: string
  dark?: string
}

/*
 * The presets, IN ORDER — and the first one is what a fresh installation gets
 * (see settingsContext's `defaultSettings`), so this list's order is a shipped
 * decision, not a layout preference.
 *
 * INK IS FIRST, which makes it the default and the one Reset returns to. It is
 * the near-black Vercel accents everything with, and an app that opens in it
 * reads as the product it is now dressed as rather than as an unconfigured
 * shell. Ordering it here rather than only changing `DEFAULT_THEME_SETTINGS`
 * is deliberate: `defaultSettings()` in the ported settings context reads THIS
 * list's first entry, and it is what the Reset button and the "have the
 * settings changed?" check both use. Set the default in one place and not the
 * other and Reset puts back a colour the app never shipped with — which is the
 * drift the note on DEFAULT_THEME_SETTINGS already records happening once.
 *
 * TrackVid's teal is still here, one place down. This change re-dressed the
 * app; it did not retire the brand colour, and an operator who wants it is one
 * swatch away.
 */
const primaryColorConfig: PrimaryColorConfig[] = [
  {
    // Near-black. `light` and `dark` bracket it so the hover and pressed states
    // have somewhere to go — at #171717 a "darker" press is almost the same
    // colour, so the lift is upward instead.
    name: 'primary-ink',
    light: '#3D3D3D',
    main: '#171717',
    dark: '#0A0A0A'
  },
  {
    name: 'primary-2',
    light: '#4EB0B1',
    main: '#0D9394',
    dark: '#096B6C'
  },
  {
    name: 'primary-1',
    light: '#8F85F3',
    main: '#7367F0',
    dark: '#675DD8'
  },
  {
    name: 'primary-3',
    light: '#FFC25A',
    main: '#FFAB1D',
    dark: '#BA7D15'
  },
  {
    name: 'primary-4',
    light: '#F0718D',
    main: '#EB3D63',
    dark: '#AC2D48'
  },
  {
    name: 'primary-5',
    light: '#5CAFF1',
    main: '#2092EC',
    dark: '#176BAC'
  }
]

export default primaryColorConfig
