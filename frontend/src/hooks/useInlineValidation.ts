import { useEffect } from 'react'

/**
 * Keeps the browser's own validation bubbles from ever showing.
 *
 * A form still refuses to submit while a control breaks its `required`,
 * `minLength` or `min`/`max`/`step`, and the browser still fires `invalid`
 * on each such control, but the bubble it would then draw is in the
 * browser's language (not the application's), looks different in each
 * browser and ignores the theme. Cancelling the event drops the bubble, and
 * Field shows the message under the control instead (see validityMessage).
 *
 * Cancelling it also drops the browser's focus on the first broken control,
 * so that is done here. `invalid` does not bubble, but a capturing listener
 * on `document` sees it from every control, which is what lets this be one
 * listener for the whole app, like useScrollbarFade.
 */
export function useInlineValidation(): void {
  useEffect(() => {
    // The controls of one failed submit fire one after the other in the
    // same task, in document order: only the first takes focus.
    let focused = false

    function handleInvalid(event: Event) {
      event.preventDefault()
      if (focused || !(event.target instanceof HTMLElement)) return
      focused = true
      event.target.focus()
      setTimeout(() => {
        focused = false
      })
    }

    document.addEventListener('invalid', handleInvalid, true)
    return () => document.removeEventListener('invalid', handleInvalid, true)
  }, [])
}
