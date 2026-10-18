import { useEffect } from 'react'

const APP_NAME = 'Gamelog'

/** Names the browser tab after what is on screen, as "Hollow Knight ·
 * Gamelog", or just "Gamelog" when given no title (the dashboard, or a page
 * still loading what it is named after).
 *
 * The previous title comes back when the caller unmounts, so the game panel
 * can rename the tab over whatever page it opened on and hand it back on
 * close. */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    const previous = document.title
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME
    return () => {
      document.title = previous
    }
  }, [title])
}
