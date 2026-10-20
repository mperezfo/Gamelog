import { countryName, flagOf } from '../lib/countries'
import { Emoji } from './Emoji'

/** Where a developer or publisher is from, as its flag, named in a tooltip
 * and for assistive technology. `decorative` for a flag right beside the
 * country's name, which needs neither. */
export function CountryFlag({ code, decorative = false }: { code: string; decorative?: boolean }) {
  if (decorative) {
    return (
      <span aria-hidden="true" className="inline-flex shrink-0">
        <Emoji value={flagOf(code)} />
      </span>
    )
  }
  const name = countryName(code)
  return (
    <span role="img" aria-label={name} data-tooltip={name} className="inline-flex shrink-0">
      <Emoji value={flagOf(code)} />
    </span>
  )
}
