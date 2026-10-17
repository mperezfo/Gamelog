import { useEffect } from 'react'

import { imageUrl } from '../lib/cover'
import { cacheImages } from '../lib/serviceWorker'
import { useGames } from './useGames'
import { useLookups } from './useLookups'
import { useSession } from './useSession'

/**
 * Keeps everything the library views read loaded, so that the copy of it on
 * the device (src/lib/offlineCache.ts) is complete whichever pages were
 * actually visited: the games, the four catalogues and every cover.
 *
 * Mounted once for a signed-in library account. Observing the queries here
 * also keeps them from being garbage-collected, and with them dropped from
 * the copy, while no page happens to show them.
 */
export function useOfflineSync() {
  const session = useSession()
  const games = useGames()
  useLookups('genres')
  useLookups('developers')
  useLookups('publishers')
  useLookups('platforms')

  const avatarUrl = session.data?.avatar_url
  useEffect(() => {
    const urls = (games.data ?? []).flatMap((game) =>
      game.cover_image_url ? [imageUrl(game.cover_image_url, 'sm'), imageUrl(game.cover_image_url, 'md')] : []
    )
    if (avatarUrl) urls.push(imageUrl(avatarUrl, 'sm'))
    void cacheImages(urls)
  }, [games.data, avatarUrl])
}
