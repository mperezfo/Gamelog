import type { ReactNode } from 'react'

interface SectionProps {
  title: string
  description?: string
  children: ReactNode
}

/** A titled block of the page. The whole layout is these, stacked. */
export function Section({ title, description, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="text-[13px] text-ink-muted">{description}</p>}
      </div>
      {children}
    </section>
  )
}
