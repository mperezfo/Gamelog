import { countryName, flagOf } from '../lib/countries'
import { Emoji } from './Emoji'

/** Where a developer or publisher is from, as its flag, named in a tooltip
 * and for assistive technology. `decorative` for a flag right beside the
 * country's name, which needs neither. A plain span rather than a flex box,
 * so that the image keeps its place on the text's baseline: a row that lines
 * its count up by baseline would otherwise take the image's bottom edge as
 * the baseline and drop the count below the name's letters. */
export function CountryFlag({ code, decorative = false }: { code: string; decorative?: boolean }) {
  if (decorative) {
    return (
      <span aria-hidden="true" className="shrink-0">
        <Emoji value={flagOf(code)} />
      </span>
    )
  }
  const name = countryName(code)
  return (
    <span role="img" aria-label={name} data-tooltip={name} className="shrink-0">
      <Emoji value={flagOf(code)} />
    </span>
  )
}
