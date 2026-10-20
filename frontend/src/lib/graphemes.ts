/** Splits text into what a reader sees as single characters, so that an
 * emoji made of several code points (a flag, a family) stays whole. */
export const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
