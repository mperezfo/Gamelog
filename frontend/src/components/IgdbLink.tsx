import type { ReactNode } from 'react'

import { igdbPage } from '../api/metadata'
import { useMetadataCapabilities } from '../hooks/useMetadata'
import type { IgdbKind } from '../types/metadata'
import { ExternalLinkIcon } from './icons'

/**
 * A record's link to IGDB (a game, a developer, publisher or platform): the
 * external-link glyph, which opens the record's page there in a new tab.
 * Without IGDB credentials the API cannot find that page, so the glyph only
 * says the link exists.
 *
 * A click on it goes no further, so that one inside something clickable (a
 * row of the Games table, say) opens IGDB without opening the game too.
 */
export function IgdbLink({
  kind,
  id,
  className = '',
  'aria-label': ariaLabel,
  children,
}: {
  kind: IgdbKind
  id: number
  className?: string
  /** For a glyph with no text beside it. */
  'aria-label'?: string
  children?: ReactNode
}) {
  const capabilities = useMetadataCapabilities()
  const content = (
    <>
      {children}
      <ExternalLinkIcon className="size-3 shrink-0" />
    </>
  )

  if (!capabilities.data?.identify) {
    return (
      <span
        data-tooltip="Linked to IGDB"
        aria-label={ariaLabel && 'Linked to IGDB'}
        role={ariaLabel ? 'img' : undefined}
        className={`inline-flex items-center gap-1 ${className}`}
      >
        {content}
      </span>
    )
  }
  return (
    <a
      href={igdbPage(kind, id)}
      target="_blank"
      rel="noopener noreferrer"
      data-tooltip="View on IGDB"
      aria-label={ariaLabel}
      onClick={(event) => event.stopPropagation()}
      className={`inline-flex items-center gap-1 transition-colors duration-75 hover:text-ink ${className}`}
    >
      {content}
    </a>
  )
}
