import type { ReactNode } from 'react'

import { InfoIcon } from './icons'

interface NoticeProps {
  /** error: something went wrong. ok: something went right. info: something
   * worth knowing, which gets an info icon. */
  tone: 'error' | 'ok' | 'info'
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
      className={`rounded-control px-2.5 py-2 text-[13px] ${styles} ${tone === 'info' ? 'flex gap-1' : ''}`}
      // An error interrupts whatever a screen reader is saying; a
      // confirmation waits its turn.
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {tone === 'info' ? (
        <>
          <InfoMark />
          <span className="min-w-0">{children}</span>
        </>
      ) : (
        children
      )}
    </p>
  )
}

/**
 * The icon in front of a note, for a flex row with the text in a span of its
 * own next to it. One line tall (1lh), so that it stays by the first line
 * when the text wraps. Centred on that line, it would read as sitting low: it
 * is taller than the capitals and hangs below the baseline. Lifted by 1px
 * (measured), it centres on the capitals instead.
 */
export function InfoMark() {
  return (
    <span className="relative -top-px flex h-[1lh] shrink-0 items-center">
      <InfoIcon className="size-3.5" />
    </span>
  )
}
