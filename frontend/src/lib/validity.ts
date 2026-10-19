/**
 * What is wrong with a control, in the application's own words.
 *
 * The browser still does the checking, from the `required`, `minLength`,
 * `min`/`max`/`step` and `type` a control already carries: only the message
 * is ours. Its own would come in the browser's language and in a bubble the
 * application cannot style (see useInlineValidation).
 */
export function validityMessage(control: HTMLInputElement | HTMLTextAreaElement): string {
  const { validity } = control

  if (validity.valueMissing) return 'Required.'
  if (validity.badInput) return control.type === 'number' ? 'Enter a number.' : 'Not a valid value.'
  if (validity.tooShort) return `At least ${control.minLength} characters.`
  if (validity.tooLong) return `At most ${control.maxLength} characters.`

  if (control instanceof HTMLInputElement) {
    const { min, max, step } = control
    if (validity.rangeUnderflow || validity.rangeOverflow) {
      if (min && max) return `Between ${min} and ${max}.`
      return validity.rangeUnderflow ? `At least ${min}.` : `At most ${max}.`
    }
    if (validity.stepMismatch) {
      const decimals = step.split('.')[1]?.length ?? 0
      if (decimals === 0 && Number(step) === 1) return 'Use a whole number.'
      if (decimals === 1 && Number(step) === 0.1) return 'Use at most one decimal.'
      return `Use steps of ${step}.`
    }
    if (validity.typeMismatch) {
      if (control.type === 'email') return 'Enter an email address.'
      if (control.type === 'url') return 'Enter a full address, starting with https://.'
    }
  }

  if (validity.patternMismatch) return 'Not in the expected format.'
  // Set by the application itself with setCustomValidity, so already ours.
  if (validity.customError) return control.validationMessage
  return 'Not a valid value.'
}
