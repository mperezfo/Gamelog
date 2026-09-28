import type { ReactNode } from 'react'

interface NoticeProps {
  tone: 'error' | 'ok'
  children: ReactNode
}

/**
 * A one-line explanation under a form. Deliberately quiet: a coloured word and
 * a tinted strip, not a banner with an icon demanding attention.
 */
export function Notice({ tone, children }: NoticeProps) {
  const styles =
    tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-sunken text-ink-muted'

  return (
    <p
      className={`rounded-control px-2.5 py-2 text-[13px] ${styles}`}
      // An error interrupts whatever a screen reader is saying; a
      // confirmation waits its turn.
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </p>
  )
}
