/**
 * OKLCH, the colour space the `tint` utilities work in (index.css), to and
 * from the hex codes the API stores. In OKLCH two colours of the same
 * lightness and chroma look as light and as vivid as each other whatever
 * their hue, which is what lets a genre's colour be picked by hue alone.
 */

export interface Oklch {
  /** Lightness, 0 to 1. */
  l: number
  /** Chroma, 0 for a grey. */
  c: number
  /** Hue in degrees, 0 to 360. */
  h: number
}

const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
const toGamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)

/** The hex code of a colour, clipped into sRGB where it falls outside. */
export function oklchToHex({ l, c, h }: Oklch): string {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)

  const lms = [
    l + 0.3963377774 * a + 0.2158037573 * b,
    l - 0.1055613458 * a - 0.0638541728 * b,
    l - 0.0894841775 * a - 1.291485548 * b,
  ].map((x) => x ** 3)

  const rgb = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ]

  return (
    '#' +
    rgb
      .map((x) => Math.round(Math.min(1, Math.max(0, toGamma(x))) * 255))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
  )
}

/** A hex code ("#4dab9a") as OKLCH, or null for anything else. */
export function hexToOklch(hex: string): Oklch | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!match) return null
  const [r, g, b] = match.slice(1).map((part) => toLinear(parseInt(part, 16) / 255))

  const [lc, mc, sc] = [
    0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
    0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
    0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
  ].map(Math.cbrt)

  const l = 0.2104542553 * lc + 0.793617785 * mc - 0.0040720468 * sc
  const a = 1.9779984951 * lc - 2.428592205 * mc + 0.4505937099 * sc
  const bb = 0.0259040371 * lc + 0.7827717662 * mc - 0.808675766 * sc

  const h = (Math.atan2(bb, a) * 180) / Math.PI
  return { l, c: Math.hypot(a, bb), h: h < 0 ? h + 360 : h }
}
