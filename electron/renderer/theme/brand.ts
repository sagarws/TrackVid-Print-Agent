/**
 * The agent's own look on top of the ported theme: TrackVid blue as the
 * accent, and a navy sidebar that stays navy in both schemes.
 */
export const BRAND_PRIMARY = '#2563EB'

export const SIDEBAR = {
  width: 240,
  bg: '#0B1A33',
  bgDark: '#0A0F1C',
  text: 'rgb(226 232 240 / 0.82)',
  textMuted: 'rgb(148 163 184 / 0.9)',
  hover: 'rgb(255 255 255 / 0.06)',
  panel: 'rgb(255 255 255 / 0.05)',
  panelBorder: 'rgb(255 255 255 / 0.08)'
} as const

export const USER = { name: 'Trackvid User', initials: 'TU' } as const
