import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Keeps a flat set of string filters/settings in sync with the URL's query
 * string, alongside whatever else lives there (like GamePanel's `?modal=`).
 *
 * `defaults` doubles as the shape of the returned object and as what a key
 * reads as once removed from the URL entirely — a value equal to its
 * default is dropped rather than written out, so a page's URL stays as
 * plain as what is actually non-default about it.
 *
 * Writes replace history instead of pushing it: a filter changes on every
 * keystroke or select, and none of those deserve their own Back-button stop.
 */
export function useFilterParams<T extends Record<string, string>>(
  defaults: T,
): [T, (key: keyof T, value: string) => void, (patch: Partial<T>) => void] {
  const [searchParams, setSearchParams] = useSearchParams()

  const values = useMemo(() => {
    const out = { ...defaults }
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const raw = searchParams.get(key as string)
      if (raw != null) out[key] = raw as T[typeof key]
    }
    return out
    // `defaults` is deliberately left out: it is a fresh object every render
    // (an inline literal at the call site) but the same content every time,
    // so depending on it would only ever recompute this for free.
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // Two keys set back to back (see GamesPage's sort/sortDir) would otherwise
  // race: each `setSearchParams` call schedules its own navigation off
  // whatever `prev` it closed over, so the second call can clobber the
  // first instead of building on it. Folding a whole patch into one
  // `setSearchParams` call keeps that atomic.
  function setFilters(patch: Partial<T>) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const key of Object.keys(patch) as (keyof T)[]) {
          const value = patch[key] as string
          if (value === defaults[key]) {
            next.delete(key as string)
          } else {
            next.set(key as string, value)
          }
        }
        return next
      },
      { replace: true },
    )
  }

  function setFilter(key: keyof T, value: string) {
    setFilters({ [key]: value } as Partial<T>)
  }

  return [values, setFilter, setFilters]
}
