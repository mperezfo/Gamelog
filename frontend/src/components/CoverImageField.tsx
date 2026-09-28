import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent } from 'react'

import { uploadImage } from '../api/images'
import { errorMessage } from '../api/client'
import { Button } from './Button'
import { ImageIcon, TrashIcon } from './icons'
import { Notice } from './Notice'

interface CoverImageFieldProps {
  /** The stored path (e.g. `/api/images/…`), or empty for no cover. */
  value: string
  onChange: (url: string) => void
  /** Where the portrait crop (GameCoverCard, aspect 3:4) is centred, as a
   * fraction of the image's width/height. Null means centred. */
  focalX: number | null
  focalY: number | null
  onFocalChange: (x: number | null, y: number | null) => void
  /** How far to zoom in on the portrait crop, anchored at the focal point.
   * Null means no zoom (1). */
  zoom: number | null
  onZoomChange: (zoom: number | null) => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 3

/** Portrait cards crop with this aspect ratio — see GameCoverCard. */
const PORTRAIT_ASPECT = 3 / 4

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** How a natural-size image of `natural` is laid out inside a `container` box
 * under `object-fit: contain`: the rendered size and the letterbox offset. */
function containGeometry(container: { width: number; height: number }, natural: { w: number; h: number }) {
  const containerAspect = container.width / container.height
  const imgAspect = natural.w / natural.h

  if (imgAspect > containerAspect) {
    const renderedWidth = container.width
    const renderedHeight = container.width / imgAspect
    return { renderedWidth, renderedHeight, offsetX: 0, offsetY: (container.height - renderedHeight) / 2 }
  }
  const renderedHeight = container.height
  const renderedWidth = container.height * imgAspect
  return { renderedWidth, renderedHeight, offsetX: (container.width - renderedWidth) / 2, offsetY: 0 }
}

/** The portrait crop window, in image pixels: the largest 3:4 box that fits
 * inside the image, since that's what `object-fit: cover` crops down to. */
function cropSize(natural: { w: number; h: number }) {
  if (natural.w / natural.h > PORTRAIT_ASPECT) {
    const height = natural.h
    return { width: height * PORTRAIT_ASPECT, height }
  }
  const width = natural.w
  return { width, height: width / PORTRAIT_ASPECT }
}

/**
 * A file upload rather than a URL field, on purpose: a URL points at
 * somebody else's server and can go dead any day, which is exactly what this
 * application exists to stop happening to a personal library. Choosing a file
 * uploads it once and the game keeps its own copy from then on.
 *
 * Shown as a banner rather than a thumbnail next to a button: it is the one
 * thing on this form worth looking at rather than reading.
 */
export function CoverImageField({
  value,
  onChange,
  focalX,
  focalY,
  onFocalChange,
  zoom,
  onZoomChange,
}: CoverImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const coverBoxRef = useRef<HTMLDivElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The Replace/Remove overlay is hover-only, which leaves no way to reach it
  // on a touch screen. `showOverlay` covers that case: a tap on the cover
  // toggles it, on top of (not instead of) the existing `group-hover`.
  const [showOverlay, setShowOverlay] = useState(false)

  // A toggle rather than pure hover must also close itself: without this, a
  // tap that opens it on a touch screen (or a click on desktop) leaves it
  // stuck open once the pointer moves away or taps somewhere else entirely.
  useEffect(() => {
    if (!showOverlay) return

    function closeIfOutside(event: globalThis.PointerEvent) {
      if (coverBoxRef.current && !coverBoxRef.current.contains(event.target as Node)) {
        setShowOverlay(false)
      }
    }
    document.addEventListener('pointerdown', closeIfOutside)
    return () => document.removeEventListener('pointerdown', closeIfOutside)
  }, [showOverlay])
  const [dragging, setDragging] = useState(false)
  // dragenter/dragleave fire for the drop zone's children too, so a plain
  // boolean would flicker off whenever the pointer crosses into the overlay
  // or a button inside it. Counting enter/leave pairs keeps `dragging` true
  // for as long as the pointer is anywhere inside the zone.
  const dragCounter = useRef(0)

  const [cropping, setCropping] = useState(false)
  const [draftX, setDraftX] = useState(focalX ?? 0.5)
  const [draftY, setDraftY] = useState(focalY ?? 0.5)
  const [draftZoom, setDraftZoom] = useState(zoom ?? MIN_ZOOM)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  // The cover view's own copy: `natural` above only ever gets set once the
  // crop editor's <img> loads, which hasn't happened yet the first time
  // someone just hovers the plain cover to check its resolution.
  const [coverNatural, setCoverNatural] = useState<{ w: number; h: number } | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const { url } = await uploadImage(file)
      onChange(url)
      onFocalChange(null, null)
      onZoomChange(null)
      setShowOverlay(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    dragCounter.current += 1
    setDragging(true)
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setDragging(false)
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    // Required for onDrop to fire at all — a plain dragover is rejected by
    // the browser as "not a drop target" otherwise.
    event.preventDefault()
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    dragCounter.current = 0
    setDragging(false)
    void handleFile(event.dataTransfer.files?.[0])
  }

  function startCropping() {
    setDraftX(focalX ?? 0.5)
    setDraftY(focalY ?? 0.5)
    setDraftZoom(zoom ?? MIN_ZOOM)
    setShowOverlay(false)
    setCropping(true)
  }

  // draftX/draftY are not "where the pointer is over the image" — they're
  // how far the crop window has travelled across its range of motion (0 =
  // window's left/top edge pinned to the image's, 1 = its right/bottom edge
  // pinned to the image's), which is what the preview-rect math below needs.
  // So a pointer position has to be converted via the crop window's own
  // size, by placing the window's *centre* under the pointer and clamping —
  // otherwise the window moves by a fraction of the pointer's travel instead
  // of matching it 1:1 on screen.
  function pickPoint(clientX: number, clientY: number) {
    if (!natural || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const { renderedWidth, offsetX, offsetY } = containGeometry(rect, natural)
    const scale = renderedWidth / natural.w
    const base = cropSize(natural)
    const crop = { width: base.width / draftZoom, height: base.height / draftZoom }

    const imgX = (clientX - rect.left - offsetX) / scale
    const imgY = (clientY - rect.top - offsetY) / scale

    const maxLeft = natural.w - crop.width
    const maxTop = natural.h - crop.height

    setDraftX(maxLeft > 0 ? clamp01((imgX - crop.width / 2) / maxLeft) : 0.5)
    setDraftY(maxTop > 0 ? clamp01((imgY - crop.height / 2) / maxTop) : 0.5)
  }

  // Pointer (not mouse) events so a drag tracks with a finger on touch too.
  // Setting the point on down as well as on move makes a plain tap still
  // jump the crop there, while a drag keeps following the pointer.
  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    pickPoint(event.clientX, event.clientY)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    pickPoint(event.clientX, event.clientY)
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const [previewRect, setPreviewRect] = useState<CSSProperties | undefined>(undefined)

  // Reads the container's rect outside render (React discourages touching a
  // ref's current value while rendering), recomputed whenever the point, the
  // image, or the container's own size changes.
  useEffect(() => {
    if (!cropping || !natural || !containerRef.current) {
      setPreviewRect(undefined)
      return
    }
    const container = containerRef.current

    function recompute() {
      const rect = container.getBoundingClientRect()
      const geometry = containGeometry(rect, natural!)
      const scale = geometry.renderedWidth / natural!.w
      const base = cropSize(natural!)
      // Zooming in shows a smaller slice of the image at the same on-screen
      // size, so the crop window shrinks by the zoom factor, still anchored
      // at the same fractional position within the image.
      const crop = { width: base.width / draftZoom, height: base.height / draftZoom }

      setPreviewRect({
        left: geometry.offsetX + (natural!.w - crop.width) * draftX * scale,
        top: geometry.offsetY + (natural!.h - crop.height) * draftY * scale,
        width: crop.width * scale,
        height: crop.height * scale,
      })
    }

    recompute()
    const observer = new ResizeObserver(recompute)
    observer.observe(container)
    return () => observer.disconnect()
  }, [cropping, natural, draftX, draftY, draftZoom])

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />

      {cropping ? (
        <>
          <div
            ref={containerRef}
            className="relative h-96 w-full touch-none cursor-crosshair overflow-hidden rounded-control bg-sunken"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <img
              src={value}
              alt=""
              draggable={false}
              onLoad={(event) =>
                setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })
              }
              className="pointer-events-none absolute inset-0 size-full object-contain select-none"
            />
            <div
              className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
              style={previewRect}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-faint">
            Zoom
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.05}
              value={draftZoom}
              onChange={(event) => setDraftZoom(Number(event.target.value))}
              className={[
                'h-4 flex-1 cursor-pointer appearance-none bg-transparent',
                'focus-visible:outline-none',
                // Track
                '[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-control [&::-webkit-slider-runnable-track]:bg-line',
                '[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-control [&::-moz-range-track]:bg-line',
                // Thumb
                '[&::-webkit-slider-thumb]:mt-[-6px] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:transition-colors [&::-webkit-slider-thumb]:duration-75',
                '[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:transition-colors [&::-moz-range-thumb]:duration-75',
                'hover:[&::-webkit-slider-thumb]:bg-accent-strong hover:[&::-moz-range-thumb]:bg-accent-strong',
                'focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-accent/40',
                'focus-visible:[&::-moz-range-thumb]:ring-2 focus-visible:[&::-moz-range-thumb]:ring-accent/40',
              ].join(' ')}
            />
            <span className="w-9 shrink-0 text-right tabular-nums text-ink-muted">{draftZoom.toFixed(2)}x</span>
          </label>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="text-xs text-ink-faint underline underline-offset-2"
              onClick={() => {
                setDraftX(0.5)
                setDraftY(0.5)
                setDraftZoom(MIN_ZOOM)
              }}
            >
              Reset to center
            </button>
            <div className="flex gap-2">
              <Button type="button" onClick={() => setCropping(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  onFocalChange(draftX, draftY)
                  onZoomChange(draftZoom === MIN_ZOOM ? null : draftZoom)
                  setCropping(false)
                }}
              >
                Save crop
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div
          ref={coverBoxRef}
          className="group relative h-96 w-full overflow-hidden rounded-control bg-sunken"
          onClick={() => value && setShowOverlay((shown) => !shown)}
          onMouseLeave={() => setShowOverlay(false)}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {value ? (
            <>
              <img
                key={value}
                src={value}
                alt=""
                draggable={false}
                onLoad={(event) =>
                  setCoverNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })
                }
                className="absolute inset-0 size-full object-cover object-top select-none"
              />
              {coverNatural && (
                <span className="pointer-events-none absolute right-2 bottom-2 rounded-[4px] bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white opacity-0 transition-opacity duration-75 group-hover:opacity-100">
                  {coverNatural.w} × {coverNatural.h}
                </span>
              )}
              <div
                className={[
                  'absolute inset-0 flex items-center justify-center gap-2 bg-black/45 transition-opacity duration-75',
                  showOverlay
                    ? 'pointer-events-auto opacity-100'
                    : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
                ].join(' ')}
              >
                <Button
                  type="button"
                  variant="secondary"
                  disabled={uploading}
                  className="bg-surface/90 hover:bg-surface"
                  onClick={(event) => {
                    event.stopPropagation()
                    inputRef.current?.click()
                  }}
                >
                  {uploading ? 'Uploading…' : 'Replace'}
                </Button>
                {!uploading && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="bg-surface/90 hover:bg-surface"
                    onClick={(event) => {
                      event.stopPropagation()
                      startCropping()
                    }}
                  >
                    Set portrait crop
                  </Button>
                )}
                {!uploading && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="bg-surface/90 px-2 hover:bg-surface"
                    onClick={(event) => {
                      event.stopPropagation()
                      onChange('')
                      onFocalChange(null, null)
                      onZoomChange(null)
                      setShowOverlay(false)
                    }}
                    aria-label="Remove cover"
                  >
                    <TrashIcon className="size-3.5" />
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-2">
              <ImageIcon className="size-5 text-ink-faint" />
              <Button type="button" disabled={uploading} onClick={() => inputRef.current?.click()}>
                {uploading ? 'Uploading…' : 'Add a cover'}
              </Button>
            </div>
          )}

          {/* A real border painted as the last child, not a CSS outline on
              the container itself: an outline with a negative offset sits
              inside the box, and Chromium then treats it as clipped content
              rather than chrome drawn above everything — with a cover image
              filling the box, that made the highlight invisible instead of
              merely faint. Being last in the DOM guarantees this paints over
              the image and the hover overlay regardless. */}
          {dragging && (
            <div className="pointer-events-none absolute inset-0 rounded-control border-2 border-dashed border-accent" />
          )}
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}
