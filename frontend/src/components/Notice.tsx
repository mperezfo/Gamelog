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
 * The icon in front of a 13px note, for a flex row with the text in a span of
 * its own next to it, by whose first line it stays when the text wraps.
 *
 * Centred on the capitals, which is 2px below the top of the line (measured).
 * That keeps it a whole number of pixels (12) above the baseline, so that it
 * snaps to the pixel grid the same way the text does: centred on the line
 * instead, it was a fraction off the baseline, and whenever the note landed
 * on a half pixel the two snapped in opposite directions, a pixel apart.
 */
export function InfoMark() {
  return (
    <span className="flex shrink-0 pt-[2px]">
      <InfoIcon className="size-3.5" />
    </span>
  )
}
