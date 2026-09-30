// React Imports
import type { ReactNode } from 'react'
import { createContext, useCallback, useMemo, useState } from 'react'

// Type Imports
import type { Mode, Skin, Layout, LayoutComponentWidth } from '@core/types'
import type { ThemeFont } from '@shared/types/appearance'

// Config Imports
import themeConfig from '@configs/themeConfig'
import primaryColorConfig from '@configs/primaryColorConfig'

/**
 * PORTED FROM TrackVid-Monitor (src/@core/contexts/settingsContext.tsx).
 *
 * Same API, different storage. Monitor keeps these in a cookie, read on the
 * server so the first HTML already carries the operator's skin. There is no
 * server here and no cookie worth having: a packaged renderer runs from a
 * file:// origin where web storage is easy to lose, and the whole point is to
 * survive an auto-update replacing the app directory.
 *
 * So persistence is a PORT rather than a built-in. This provider takes the
 * settings it should start with and a function to call when they change; the
 * preferences IPC is plugged into both at the app's root. That keeps this file
 * free of Electron — it is still just React state — and it keeps the decision
 * about where settings live in one place.
 *
 * Dropped from Monitor's copy: `semiDark`.
 */

// Settings type
export type Settings = {
  mode?: Mode
  skin?: Skin
  layout?: Layout
  navbarContentWidth?: LayoutComponentWidth
  contentWidth?: LayoutComponentWidth
  footerContentWidth?: LayoutComponentWidth
  primaryColor?: string
  /**
   * The typeface, from the ones the app ships with.
   *
   * NOT IN MONITOR'S SETTINGS. A web app can offer any Google font because the
   * browser will fetch it; a packaged desktop app can only offer what is on the
   * disk beside it. So the choice is real but short — see styles/fonts.css.
   */
  font?: ThemeFont
}

// UpdateSettingsOptions type
type UpdateSettingsOptions = {
  /**
   * Monitor calls this `updateCookie`. It means "remember this", and a page
   * that tints itself for as long as it is open passes false.
   */
  persist?: boolean
}

// SettingsContextProps type
type SettingsContextProps = {
  settings: Settings
  updateSettings: (settings: Partial<Settings>, options?: UpdateSettingsOptions) => void
  isSettingsChanged: boolean
  resetSettings: () => void
  updatePageSettings: (settings: Partial<Settings>) => () => void
}

type Props = {
  children: ReactNode
  /** What was stored, or null on a fresh installation. */
  storedSettings?: Settings | null
  /** Called with the full settings whenever one of them is changed for good. */
  onPersist?: (settings: Settings) => void
  mode?: Mode
}

/*
 * The first preset is the shipped accent. Asserted at module load rather than
 * defaulted at every call site: an empty colour list is a mistake in the config
 * file, and it should say so once, loudly, instead of quietly leaving the app
 * with no primary colour.
 */
const [firstPrimary] = primaryColorConfig

if (!firstPrimary) throw new Error('primaryColorConfig must list at least one colour')

/** What a fresh installation looks like. Also what Reset returns to. */
export const defaultSettings = (): Settings => ({
  mode: themeConfig.mode,
  skin: themeConfig.skin,
  layout: themeConfig.layout,
  navbarContentWidth: themeConfig.navbar.contentWidth,
  contentWidth: themeConfig.contentWidth,
  footerContentWidth: themeConfig.footer.contentWidth,
  primaryColor: firstPrimary.main
})

// Initial Settings Context
export const SettingsContext = createContext<SettingsContextProps | null>(null)

// Settings Provider
export const SettingsProvider = (props: Props) => {
  const { children, storedSettings, onPersist, mode } = props

  const initialSettings = useMemo<Settings>(
    () => ({ ...defaultSettings(), mode: mode ?? themeConfig.mode }),
    [mode]
  )

  /*
   * Seeded synchronously, not fetched. The stored settings ride in with the
   * first render, so the app never paints one frame of the default skin and
   * then snaps to the operator's — which is the same flash the window's own
   * background colour exists to prevent.
   */
  const [settings, setSettings] = useState<Settings>(() => ({
    ...initialSettings,
    ...(storedSettings ?? {})
  }))

  const updateSettings = useCallback(
    (update: Partial<Settings>, options?: UpdateSettingsOptions) => {
      const { persist = true } = options ?? {}

      setSettings(previous => {
        const next = { ...previous, ...update }

        if (persist) onPersist?.(next)

        return next
      })
    },
    [onPersist]
  )

  /**
   * Updates the settings for as long as a screen is open.
   *
   * Nothing is written, so navigating away restores what was stored. Returns
   * the undo, which is what an effect's cleanup wants.
   */
  const updatePageSettings = useCallback(
    (update: Partial<Settings>): (() => void) => {
      updateSettings(update, { persist: false })

      return () => updateSettings({ ...initialSettings, ...(storedSettings ?? {}) }, { persist: false })
    },
    [initialSettings, storedSettings, updateSettings]
  )

  const resetSettings = useCallback(() => {
    updateSettings(defaultSettings())
  }, [updateSettings])

  const isSettingsChanged = useMemo(
    () => JSON.stringify(defaultSettings()) !== JSON.stringify(settings),
    [settings]
  )

  const value = useMemo<SettingsContextProps>(
    () => ({ settings, updateSettings, isSettingsChanged, resetSettings, updatePageSettings }),
    [isSettingsChanged, resetSettings, settings, updatePageSettings, updateSettings]
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
