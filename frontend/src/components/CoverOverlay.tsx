/** A soft vignette over cover art: the edges darken slightly so the image
 * sits in its frame instead of ending abruptly. Drawn over the image rather
 * than baked into it, so it follows any crop. The parent must be `relative`
 * and clip its children (`overflow-hidden`). */
export function CoverOverlay() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{ background: 'radial-gradient(ellipse at center, transparent 60%, rgb(0 0 0 / 0.28) 100%)' }}
    />
  )
}
