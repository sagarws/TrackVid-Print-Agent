/*
 * PORTED FROM TrackVid-Monitor (src/configs/themeConfig.ts).
 *
 * These are the DEFAULTS. What the operator has chosen lives in
 * userData/preferences.json and is layered on top — see the settings context —
 * so changing a value here only moves a fresh installation.
 *
 * Dropped from Monitor's copy: `semiDark` (a web-template nav tint), the
 * horizontal layout, and the cookie name, which has no meaning here.
 *
 * Monitor's original note follows:
 * If you change the following items in the config object, you will not see any effect in the local development server
 * as these are stored in the cookie (cookie has the highest priority over the themeConfig):
 * 1. mode
 * 2. skin
 * 3. semiDark
 * 4. layout
 * 5. navbar.contentWidth
 * 6. contentWidth
 * 7. footer.contentWidth
 *
 * To see the effect of the above items, you can click on the reset button from the Customizer
 * which is on the top-right corner of the customizer besides the close button.
 * This will reset the cookie to the values provided in the config object below.
 *
 * Another way is to clear the cookie from the browser's Application/Storage tab and then reload the page.
 */

// Third-party Imports
// react-toastify is not a dependency here; the union is spelled out instead.
type ToastPosition = 'top-right' | 'top-center' | 'top-left' | 'bottom-right' | 'bottom-center' | 'bottom-left'

// Type Imports
import type { Mode, Skin, Layout, LayoutComponentPosition, LayoutComponentWidth } from '@core/types'

type Navbar = {
  type: LayoutComponentPosition
  contentWidth: LayoutComponentWidth
  floating: boolean
  detached: boolean
  blur: boolean
}

type Footer = {
  type: LayoutComponentPosition
  contentWidth: LayoutComponentWidth
  detached: boolean
}

export type Config = {
  templateName: string
  homePageUrl: string
  mode: Mode
  skin: Skin
  layout: Layout
  layoutPadding: number
  navbar: Navbar
  contentWidth: LayoutComponentWidth
  compactContentWidth: number
  footer: Footer
  disableRipple: boolean
  toastPosition: ToastPosition
}

const themeConfig: Config = {
  templateName: 'TrackVid Print Agent',
  homePageUrl: '/dashboards/crm',
  // LIGHT, not 'system'. The app is used on machines whose OS theme is set
  // for everything else on them, and a claim screen flipping to dark at sunset
  // is not a preference anyone expressed. The Mode control still offers all
  // three; this is only what a fresh installation starts on.
  mode: 'light', // 'system', 'light', 'dark'
  skin: 'default', // 'default', 'bordered'
  layout: 'vertical', // 'vertical', 'collapsed'
  layoutPadding: 24, // Common padding for header, content, footer layout components (in px)
  compactContentWidth: 1440, // in px
  navbar: {
    type: 'fixed', // 'fixed', 'static'
    contentWidth: 'compact', // 'compact', 'wide'
    floating: true, //! true, false (This will not work in the Horizontal Layout)
    detached: true, //! true, false (This will not work in the Horizontal Layout or floating navbar is enabled)
    blur: true // true, false
  },
  contentWidth: 'compact', // 'compact', 'wide'
  footer: {
    type: 'static', // 'fixed', 'static'
    contentWidth: 'compact', // 'compact', 'wide'
    detached: true //! true, false (This will not work in the Horizontal Layout)
  },
  disableRipple: false, // true, false
  toastPosition: 'top-right' // 'top-right', 'top-center', 'top-left', 'bottom-right', 'bottom-center', 'bottom-left'
}

export default themeConfig
