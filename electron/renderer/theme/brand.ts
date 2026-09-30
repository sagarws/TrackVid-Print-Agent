/**
 * The agent's own look on top of the ported theme: TrackVid's primary teal
 * (TrackVid-FE src/theme/tokens.ts, `primary`) as the accent, and a dark teal
 * sidebar that stays dark in both schemes. No blue anywhere.
 */
export const BRAND_PRIMARY = '#0088A3'

export const SIDEBAR = {
  width: 240,
  bg: '#0A2E35',
  bgDark: '#061C21',
  text: 'rgb(226 232 240 / 0.82)',
  textMuted: 'rgb(148 163 184 / 0.9)',
  hover: 'rgb(255 255 255 / 0.06)',
  panel: 'rgb(255 255 255 / 0.05)',
  panelBorder: 'rgb(255 255 255 / 0.08)'
} as const

export const USER = { name: 'Trackvid User', initials: 'TU' } as const
