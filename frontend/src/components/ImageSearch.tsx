import { useState } from 'react'

import { errorMessage } from '../api/client'
import { SOURCE_NAMES } from '../lib/imageSources'
import { useGameImages } from '../hooks/useMetadata'
import type { GameImage, ImageKind, ImageSearchGame, ImageSource } from '../types/metadata'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { Dots } from './Dots'
import { Dropdown } from './Dropdown'
import { XIcon } from './icons'
import { Notice } from './Notice'

const KIND_NAMES: Record<ImageKind, string> = {
  cover: 'Cover',
  artwork: 'Artwork',
  grid: 'Grids',
  hero: 'Heroes',
}

interface ImageSearchProps {
  /** The title to look the game up by. */
  title: string
  /** The IGDB game the form is linked to, whose images IGDB shows first
   * rather than those of the title's top match. */
  igdbId: number | null
  /** The sources to offer, one tab each. */
  sources: ImageSource[]
  /** Called with the picked image, straight away: importing it is up to
   * the caller, which can show it in the meantime. */
  onPick: (image: GameImage) => void
  onClose: () => void
}

/**
 * Looks the game up on IGDB and SteamGridDB and shows their images to pick
 * a cover from, in a popup large enough to tell them apart.
 */
export function ImageSearch({ title, igdbId, sources, onPick, onClose }: ImageSearchProps) {
  const [source, setSource] = useState<ImageSource>(sources[0])
  // The match picked on each source, when it is not the one shown first.
  // Kept here rather than in each tab, so that a tab keeps it while hidden.
  const [switched, setSwitched] = useState<Partial<Record<ImageSource, number>>>({})

  return (
    <Dialog aria-label={`Images for ${title}`} onClose={onClose}>
      <div className="flex shrink-0 flex-col gap-3 border-b border-line px-4 pt-4 pb-3 sm:px-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-base font-semibold tracking-tight text-ink">
            Images for “{title}”
          </h2>
          <Button variant="ghost" className="shrink-0 px-2" onClick={onClose} aria-label="Close">
            <XIcon />
          </Button>
        </div>
        {sources.length > 1 && (
          <div className="flex gap-1" role="tablist" aria-label="Image source">
            {sources.map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={option === source}
                onClick={() => setSource(option)}
                className={[
                  'rounded-control px-2.5 py-1 text-[13px] font-medium transition-colors duration-75',
                  option === source ? 'bg-sunken text-ink' : 'text-ink-muted hover:text-ink',
                ].join(' ')}
              >
                {SOURCE_NAMES[option]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Keyed by source, so that a tab starts with its own scroll and its
          own requests. */}
      <SourceImages
        key={source}
        source={source}
        title={title}
        firstGameId={source === 'igdb' ? igdbId : null}
        switchedGameId={switched[source] ?? null}
        onSwitch={(id) => setSwitched((current) => ({ ...current, [source]: id ?? undefined }))}
        onPick={onPick}
      />
    </Dialog>
  )
}

interface SourceImagesProps {
  source: ImageSource
  title: string
  /** The game to show first instead of the title's top match, if any. */
  firstGameId: number | null
  /** The match picked instead of the first, if any. */
  switchedGameId: number | null
  /** Picks another match; null goes back to the first. */
  onSwitch: (id: number | null) => void
  onPick: (image: GameImage) => void
}

function SourceImages({
  source,
  title,
  firstGameId,
  switchedGameId,
  onSwitch,
  onPick,
}: SourceImagesProps) {
  // The first search brings the title's matches along. Switching to another
  // one only asks for its images: the matches stay those of the first.
  const first = useGameImages(source, title, firstGameId)
  const other = useGameImages(source, null, switchedGameId, switchedGameId !== null)
  const shown = switchedGameId !== null ? other : first

  const games = first.data?.games ?? []
  const shownGameId = switchedGameId ?? first.data?.game_id ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {first.data && games.length > 1 && (
        <div className="shrink-0 px-4 pt-3 sm:px-5">
          <Dropdown
            aria-label="Game"
            value={shownGameId === null ? '' : String(shownGameId)}
            onChange={(value) => {
              const id = Number(value)
              onSwitch(id === first.data?.game_id ? null : id)
            }}
            options={games.map((game) => ({ value: String(game.id), label: gameLabel(game) }))}
            // The linked game may not be among the title's matches, and IGDB
            // is not asked for its name only to show it here.
            placeholder="The linked game"
            className="h-9 w-full rounded-control bg-sunken px-2.5 text-sm text-ink sm:w-96"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
        {shown.isPending ? (
          <p className="text-sm text-ink-faint">
            Searching {SOURCE_NAMES[source]}
            <Dots />
          </p>
        ) : shown.isError ? (
          <Notice tone="error">{errorMessage(shown.error)}</Notice>
        ) : shown.data.game_id === null ? (
          <p className="text-sm text-ink-faint">No games found on {SOURCE_NAMES[source]}.</p>
        ) : shown.data.images.length === 0 ? (
          <p className="text-sm text-ink-faint">{SOURCE_NAMES[source]} has no images of this game.</p>
        ) : (
          <ImageGrid images={shown.data.images} onPick={onPick} />
        )}
      </div>
    </div>
  )
}

function gameLabel(game: ImageSearchGame): string {
  return game.release_date ? `${game.name} (${game.release_date.slice(0, 4)})` : game.name
}

interface ImageGridProps {
  images: GameImage[]
  onPick: (image: GameImage) => void
}

/** The images, grouped by kind in the order the API gives them. */
function ImageGrid({ images, onPick }: ImageGridProps) {
  const groups: { kind: ImageKind; images: GameImage[] }[] = []
  for (const image of images) {
    const group = groups.find((g) => g.kind === image.kind)
    if (group) group.images.push(image)
    else groups.push({ kind: image.kind, images: [image] })
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        // A group of nothing but wide images (heroes, most artworks) gets
        // half the columns instead, which spanning two would leave a gap
        // beside on a row of three.
        const allWide = group.images.every(isWide)
        return (
          <section key={group.kind} className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-ink-faint">{KIND_NAMES[group.kind]}</h3>
            {/* Dense, so that a portrait image fills the gap a wide one
                leaves behind it. */}
            <ul
              className={[
                'grid grid-flow-row-dense gap-2 sm:gap-3',
                allWide ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6',
              ].join(' ')}
            >
              {group.images.map((image) => (
                // Among narrower ones, a wide image takes two columns, where
                // one would leave it a sliver.
                <li key={image.url} className={!allWide && isWide(image) ? 'col-span-2' : ''}>
                  <ImageOption image={image} onPick={() => onPick(image)} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function isWide(image: GameImage): boolean {
  return image.width > image.height * 1.2
}

interface ImageOptionProps {
  image: GameImage
  onPick: () => void
}

function ImageOption({ image, onPick }: ImageOptionProps) {
  const [failed, setFailed] = useState(false)
  const size = image.width && image.height ? `${image.width} × ${image.height}` : null

  return (
    <button
      type="button"
      onClick={onPick}
      data-tooltip={size ? `Use this image (${size})` : 'Use this image'}
      aria-label={size ? `Use this image (${size})` : 'Use this image'}
      className={[
        'group relative block w-full overflow-hidden rounded-[4px] bg-sunken',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'hover:ring-2 hover:ring-accent',
      ].join(' ')}
      // The image's own shape, so that portrait covers and wide banners both
      // show whole. A source that does not say gets the shape of a cover.
      style={{ aspectRatio: image.width && image.height ? `${image.width} / ${image.height}` : '3 / 4' }}
    >
      {/* Shown straight from the source rather than through the API: only
          the picked image is ever copied into the library. One that does not
          load leaves the empty tile rather than a broken image: the
          full-size one may well still import. */}
      {!failed && (
        <img
          src={image.thumb_url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(true)}
          className="size-full object-cover select-none"
        />
      )}
      {size && (
        <span className="pointer-events-none absolute right-1 bottom-1 rounded-[3px] bg-black/60 px-1 py-px text-[10px] font-medium text-white opacity-0 transition-opacity duration-75 group-hover:opacity-100">
          {size}
        </span>
      )}
    </button>
  )
}
