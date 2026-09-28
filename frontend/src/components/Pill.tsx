/** A small neutral pill for a plain name — developers, publishers. */
export function Pill({ children }: { children: string }) {
  return (
    <span className="inline-flex max-w-full items-center truncate rounded-[4px] bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
      {children}
    </span>
  )
}
