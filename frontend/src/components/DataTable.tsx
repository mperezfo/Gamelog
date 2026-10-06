import { memo } from 'react'

import { flexRender, type Table } from '@tanstack/react-table'

import { ChevronDownIcon, ChevronUpIcon } from './icons'

interface DataTableProps<T> {
  table: Table<T>
  onRowClick?: (row: T) => void
  emptyMessage?: string
}

/**
 * A Notion-style table: thin row dividers, no zebra striping, sort by
 * clicking a header. Sorting happens client-side — a personal game library is
 * a few hundred rows at most, not a dataset that needs the server's help.
 *
 * The table instance itself (data, columns, sorting state) lives with the
 * caller rather than in here: GamesPage shares that same sorted order with
 * its grid view, so switching between the two keeps whatever the user
 * sorted by instead of resetting it.
 *
 * Horizontal scroll rather than a stacked-card layout on narrow screens: with
 * this many columns a card view would need its own design per entity, and a
 * scrollable table stays usable with a thumb.
 */
function DataTableInner<T>({ table, onRowClick, emptyMessage = 'Nothing here yet.' }: DataTableProps<T>) {
  const rows = table.getRowModel().rows

  if (rows.length === 0) {
    return <p className="px-1 py-6 text-[13px] text-ink-faint">{emptyMessage}</p>
  }

  const totalWidth = table.getAllLeafColumns().reduce((sum, column) => sum + column.getSize(), 0)

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ tableLayout: 'fixed', minWidth: totalWidth }}>
        <colgroup>
          {table.getAllLeafColumns().map((column) => (
            <col key={column.id} style={{ width: column.getSize() }} />
          ))}
        </colgroup>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sortable = header.column.getCanSort()
                const direction = header.column.getIsSorted()

                return (
                  <th
                    key={header.id}
                    className="overflow-hidden border-b border-line-strong px-3 py-2 text-left text-xs font-medium text-ellipsis whitespace-nowrap text-ink-faint select-none"
                  >
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        disabled={!sortable}
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 disabled:cursor-default"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sortable &&
                          (direction === 'asc' ? (
                            <ChevronUpIcon className="size-3" />
                          ) : direction === 'desc' ? (
                            <ChevronDownIcon className="size-3" />
                          ) : null)}
                      </button>
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              data-tap-target={onRowClick ? '' : undefined}
              className={[
                'border-b border-line',
                onRowClick ? 'cursor-pointer hover:bg-hover' : '',
              ].join(' ')}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2 text-ink">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Cast preserves the generic signature that `memo` would otherwise erase.
export const DataTable = memo(DataTableInner) as typeof DataTableInner
