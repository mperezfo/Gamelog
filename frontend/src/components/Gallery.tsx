import type { ReactNode } from 'react'

import { useEdgeFade } from '../hooks/useEdgeFade'

/** A horizontally scrolling strip of cover cards — Top rated, Best of each
 * genre, and the Coming up panel's other upcoming releases. */
export function Gallery({ children }: { children: ReactNode }) {
  const fadeRef = useEdgeFade('x')
  return (
    <div ref={fadeRef} className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
      {children}
    </div>
  )
}
