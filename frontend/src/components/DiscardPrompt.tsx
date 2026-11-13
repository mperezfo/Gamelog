import { Button } from './Button'

interface DiscardPromptProps {
  onDiscard: () => void
  onKeep: () => void
  className?: string
}

/** The one way the app asks before unsaved changes are thrown away: closing
 * the game panel, cancelling a lookup form, or leaving a section from the
 * sidebar. */
export function DiscardPrompt({ onDiscard, onKeep, className = '' }: DiscardPromptProps) {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center justify-between gap-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-ink ${className}`}
    >
      <span>Discard unsaved changes?</span>
      <div className="flex gap-2">
        <Button variant="danger" onClick={onDiscard}>
          Discard
        </Button>
        <Button onClick={onKeep}>Keep editing</Button>
      </div>
    </div>
  )
}
