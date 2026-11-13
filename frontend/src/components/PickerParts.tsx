import type { ReactNode } from 'react'

import { COLUMN_WIDTH } from '../lib/pickerGrid'

/** The row a tab's search box sits in, lined up with the grid. */
export function PanelSearch({ children }: { children: ReactNode }) {
  return <div className={`${COLUMN_WIDTH} pt-2 pb-1`}>{children}</div>
}

/** The footer of either tab: what is pointed at, and Remove where the field
 * has a value. */
export function PanelFooter({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <div className="shrink-0 border-t border-line">
      <div className={`${COLUMN_WIDTH} flex h-10 items-center justify-between gap-2`}>
        <span className="truncate pl-1.5 text-xs text-ink-muted">{label}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 rounded-control px-2 py-1 text-xs font-medium text-ink-muted transition-colors duration-75 hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}
