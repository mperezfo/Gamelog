import type { ReactNode } from 'react'

import { COLUMN_WIDTH } from '../lib/pickerGrid'

/** The row a tab's search box sits in, lined up with the grid. */
export function PanelSearch({ children }: { children: ReactNode }) {
  return <div className={`${COLUMN_WIDTH} pt-2 pb-1`}>{children}</div>
}
