import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { Query } from '@tanstack/react-query'
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client'
import { del, get, set } from 'idb-keyval'

/**
 * The copy of the query cache kept on the device, which is what the app shows
 * when the server cannot be reached (#38).
 *
 * It lives in IndexedDB rather than localStorage: it is not size-capped at a
 * few megabytes, and writing it does not block the page.
 */

const STORAGE_KEY = 'gamelog-query-cache'

const persister = createAsyncStoragePersister({
  storage: { getItem: get<string>, setItem: set, removeItem: del },
  key: STORAGE_KEY,
})

/** Queries that make no sense to show from an old copy: the API's live
 * health, and the admin's account list, which stays behind a connection. */
const NOT_KEPT = new Set(['health', 'users'])

/** Anything with data to show, including a query whose last refresh failed:
 * while offline every refresh does, and the copy must outlive that. */
function shouldKeep(query: Query) {
  return query.state.data !== undefined && !NOT_KEPT.has(String(query.queryKey[0]))
}

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  // How long an untouched copy stays usable. Opening the app while online
  // refreshes it, so this only bounds a device left offline for that long.
  maxAge: 1000 * 60 * 60 * 24 * 90,
  // A different build may expect a different shape, so its copy is dropped
  // rather than trusted. The next online visit writes a new one.
  buster: __BUILD_ID__,
  dehydrateOptions: { shouldDehydrateQuery: shouldKeep },
}

/** Deletes the copy, so that nothing read while signed in stays behind on
 * this device. */
export function clearOfflineCache() {
  return persister.removeClient()
}
