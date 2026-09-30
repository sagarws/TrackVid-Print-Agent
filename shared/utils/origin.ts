/**
 * Which websites may talk to the agent.
 *
 * A browser attaches the page's Origin to every cross-origin request and a page
 * cannot forge it, so this list is what stops an arbitrary website the packer
 * has open from printing on their printers. Two forms are accepted:
 *
 *   https://trackvid.in        exactly that origin
 *   https://*.trackvid.in      any subdomain, one or more levels deep, same
 *                              scheme and port — NOT the bare domain itself
 */

/** Normalise an origin the way a browser serialises one; null if it is not one. */
export const normaliseOrigin = (value: string): string | null => {
  const trimmed = value.trim()
  const wildcard = /^(https?):\/\/\*\.(.+)$/i.exec(trimmed)
  if (wildcard) {
    const [, scheme = '', rest = ''] = wildcard
    const inner = normaliseOrigin(`${scheme}://${rest}`)
    if (!inner) return null
    return inner.replace('://', '://*.')
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  // An origin has no path, query, fragment or credentials. Anything that has
  // them was typed as a URL, not an origin, and is refused rather than guessed.
  if (url.username || url.password || url.search || url.hash) return null
  if (url.pathname !== '/' || !/^https?:\/\/[^/]+\/?$/i.test(trimmed)) return null
  return url.origin
}

export const isOriginAllowed = (origin: string | undefined, allowed: readonly string[]): boolean => {
  if (!origin) return false
  const candidate = normaliseOrigin(origin)
  if (!candidate || candidate.includes('*')) return false

  return allowed.some(entry => {
    const rule = normaliseOrigin(entry)
    if (!rule) return false
    if (!rule.includes('://*.')) return rule === candidate

    const [scheme, suffix] = rule.split('://*.') as [string, string]
    if (!candidate.startsWith(`${scheme}://`)) return false
    const host = candidate.slice(scheme.length + 3)
    return host.endsWith(`.${suffix}`)
  })
}
