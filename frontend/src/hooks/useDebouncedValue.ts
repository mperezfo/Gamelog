import { useEffect, useState } from 'react'

/** Trails `value` by `delayMs`, so callers can defer expensive work (like
 * re-filtering a table on every keystroke) until typing pauses. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
