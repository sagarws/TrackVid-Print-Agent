// React Imports
import { useEffect, useState } from 'react'

/**
 * Whether a media query matches, with a value to use before it can be asked.
 *
 * REPLACES `react-use`, which Monitor uses for exactly four hooks — `useMedia`,
 * `useUpdateEffect`, `useDebounce` and `useCookie`. `useCookie` is the one this
 * app is deliberately replacing with the preferences file, and the other three
 * are ten lines each. The package itself carries a high advisory through its
 * `js-cookie` dependency, and pulling a vulnerable transitive into a shipped
 * desktop app to save thirty lines is a bad trade.
 *
 * The default matters: it is what the first render uses, before any listener
 * has fired. Passing the mode the window was told to open in keeps the first
 * frame from being the wrong one.
 */
export const useMedia = (query: string, defaultState = false): boolean => {
  const [matches, setMatches] = useState(defaultState)

  useEffect(() => {
    const list = window.matchMedia(query)
    const update = (): void => setMatches(list.matches)

    update()
    list.addEventListener('change', update)

    // Always removed: a listener on `window.matchMedia` outlives the component
    // that added it, and a theme that reacts twice is a theme that flickers.
    return () => list.removeEventListener('change', update)
  }, [query])

  return matches
}
