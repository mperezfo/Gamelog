/** Whether `element` is a place where typing a letter should type it, not
 * trigger a keyboard shortcut. */
export function isTypingTarget(element: Element | null): boolean {
  if (!element) return false
  if (element instanceof HTMLElement && element.isContentEditable) return true
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
}
