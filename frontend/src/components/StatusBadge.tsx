import type { ReactNode } from 'react'

type Tone = 'ok' | 'error' | 'pending'

const TONES: Record<Tone, string> = {
  ok: 'text-ok',
  error: 'text-danger',
  pending: 'text-ink-faint',
}

interface StatusBadgeProps {
  tone: Tone
  children: ReactNode
}

/** A dot and a word. Small enough to sit in a footer without asking for attention. */
export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${TONES[tone]}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  )
}
