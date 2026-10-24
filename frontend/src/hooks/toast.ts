import { createContext, use } from 'react'

export interface Toast {
  /** What happened, in a few words. Read out by screen readers too. */
  message: string
  /** The one thing that can be done about it, such as Undo. */
  action?: { label: string; onPress: () => void }
  /** Called when the toast goes away without its action being pressed: on
   * its own, closed, or replaced by the next one. */
  onExpire?: () => void
}

export interface Toasts {
  /** Shows a toast, in place of the one on screen, if any. */
  show: (toast: Toast) => void
}

/**
 * The app's one small message that is not tied to a form: a delete that can
 * still be undone, or a save that failed where nothing else would say so.
 * Not a general notification system. The context lives apart from its
 * provider (see ToastProvider) for the reason themeContext gives.
 */
export const ToastContext = createContext<Toasts | null>(null)

export function useToast(): Toasts {
  const context = use(ToastContext)
  if (!context) throw new Error('useToast was called outside ToastProvider')
  return context
}
