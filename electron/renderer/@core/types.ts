// React Imports
import type { ReactNode } from 'react'

/*
 * No 'horizontal'. Monitor offers a horizontal navbar layout for the web
 * template; a desktop window has one shell and the second one would double the
 * menu port for a layout nobody would pick. 'collapsed' IS the vertical rail
 * with its labels hidden, which is the collapse behaviour we do want.
 */
export type Layout = 'vertical' | 'collapsed'

export type Skin = 'default' | 'bordered'

export type Mode = 'system' | 'light' | 'dark'

export type SystemMode = 'light' | 'dark'

/*
 * Left-to-right only. RTL in Monitor means a stylis plugin rewriting every
 * rule at runtime, and this app ships in one language. The type stays so the
 * ported components keep their signatures.
 */
export type Direction = 'ltr'

export type LayoutComponentWidth = 'compact' | 'wide'

export type LayoutComponentPosition = 'fixed' | 'static'

export type ChildrenType = {
  children: ReactNode
}

export type ThemeColor = 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success'
