import { useCallback, useSyncExternalStore } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { errorMessage } from '../api/client'
import { createGame, deleteGame, gameStats, getGame, listGames, updateGame } from '../api/games'
import type { Game, GameFilter, GameInput } from '../types/game'
import { useToast } from './toast'

const gamesKey = (filter: GameFilter = {}) => ['games', filter] as const
const gameKey = (ref: number | string) => ['games', 'detail', ref] as const
const statsKey = (filter: GameFilter = {}) => ['games', 'stats', filter] as const

/** Games matching a filter. An empty filter is the whole library, less any
 * game deleted a moment ago and still waiting for its Undo to run out (see
 * useDeleteGame). */
export function useGames(filter: GameFilter = {}) {
  const deleting = useSyncExternalStore(subscribeDeletes, deletesSnapshot)
  const select = useCallback(
    (games: Game[]) => (deleting.size === 0 ? games : games.filter((game) => !deleting.has(game.id))),
    [deleting],
  )
  return useQuery({ queryKey: gamesKey(filter), queryFn: () => listGames(filter), select })
}

/** The games deleted but not sent to the server yet, while their toast can
 * still undo it. Outside React's state because every list of games reads
 * it, and a page being closed has to reach it too (see useDeleteGame). A new
 * Set on each change, so that a reader sees it change. */
let deleting: ReadonlySet<number> = new Set()
const deleteListeners = new Set<() => void>()

function subscribeDeletes(listener: () => void) {
  deleteListeners.add(listener)
  return () => deleteListeners.delete(listener)
}

function deletesSnapshot() {
  return deleting
}

function setDeleting(id: number, on: boolean) {
  const next = new Set(deleting)
  if (on) next.add(id)
  else next.delete(id)
  deleting = next
  deleteListeners.forEach((listener) => listener())
}

/** The table footer: count, average score, logged-date range. */
export function useGameStats(filter: GameFilter = {}) {
  return useQuery({ queryKey: statsKey(filter), queryFn: () => gameStats(filter) })
}

/** ref is a game's numeric id or its slug.
 *
 * The library list already holds every game in the same shape, so a game
 * starts from its copy there: it opens at once, and also when the server
 * cannot be reached and the game was never opened on this device. */
export function useGame(ref: number | string | undefined) {
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: gameKey(ref ?? ''),
    queryFn: () => getGame(ref as number | string),
    enabled: ref !== undefined,
    initialData: () =>
      queryClient
        .getQueryData<Game[]>(gamesKey())
        ?.find((game) => game.slug === ref || String(game.id) === String(ref)),
    // As old as the list it came from, so it is refetched as soon as that
    // would have been.
    initialDataUpdatedAt: () => queryClient.getQueryState(gamesKey())?.dataUpdatedAt,
  })
}

/** Invalidates every games query: any filter, any stats, any single game. */
function invalidateGames(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['games'] })
}

/** After a save. One that created developers, publishers or a platform along
 * with the game (see GameInput's new_developers), or linked them to IGDB,
 * changed those lists too; the rest, a drag on the Dashboard's board above
 * all, leave them alone and do not refetch them. */
function invalidateSavedGame(queryClient: ReturnType<typeof useQueryClient>, input: GameInput) {
  invalidateGames(queryClient)
  if (input.new_developers?.length || input.developer_links?.length) {
    void queryClient.invalidateQueries({ queryKey: ['developers'] })
  }
  if (input.new_publishers?.length || input.publisher_links?.length) {
    void queryClient.invalidateQueries({ queryKey: ['publishers'] })
  }
  if (input.new_platform || input.platform_link) {
    void queryClient.invalidateQueries({ queryKey: ['platforms'] })
  }
}

/** The fields `Game` and `GameInput` share by name and type. A PUT always
 * replaces every one of them (see `position` above), so patching all of
 * them here from `input` exactly mirrors what the server is about to save —
 * everything except the four relation arrays, which don't share `Game`'s
 * own shape (full lookup objects, not ids) and are left for the following
 * invalidate/refetch to settle. */
function patchGame(game: Game, input: GameInput): Game {
  return {
    ...game,
    title: input.title,
    status: input.status,
    position: input.position,
    score: input.score ?? null,
    tagline: input.tagline ?? null,
    notes: input.notes ?? null,
    cover_image_url: input.cover_image_url ?? null,
    cover_focal_x: input.cover_focal_x ?? null,
    cover_focal_y: input.cover_focal_y ?? null,
    cover_zoom: input.cover_zoom ?? null,
    release_date: input.release_date ?? null,
    logged_date: input.logged_date ?? null,
    platform_id: input.platform_id ?? null,
    igdb_id: input.igdb_id ?? null,
  }
}

/** Every cached list-of-games query, regardless of filter — as opposed to a
 * single-game or stats query, which also start with `['games', ...]` but
 * hold a different shape. */
function isGamesListQuery(queryKey: readonly unknown[]) {
  return queryKey[0] === 'games' && typeof queryKey[1] === 'object'
}

export function useCreateGame() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: GameInput) => createGame(input),
    onSuccess: (_game, input) => invalidateSavedGame(queryClient, input),
  })
}

/** A drag-and-drop reorder or status change on the Dashboard board is the
 * main caller here, often several in a row (see Dashboard's duplicate-
 * position renumbering) — waiting for each PUT's round trip before
 * updating the board made a drop visibly snap back to its old spot for a
 * beat before jumping to its new one. Patching the cached list immediately
 * (`onMutate`) and only rolling it back if the request actually fails is
 * what makes a drop land where it was dropped, instantly. */
export function useUpdateGame() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: GameInput }) => updateGame(id, input),
    onMutate: async ({ id, input }) => {
      // The cache write happens before `cancelQueries` is awaited, not
      // after — it has to land in the same microtask as the drop itself
      // (before dnd-kit's own drop animation samples the destination
      // card's DOM position on the next animation frame) or the ghost
      // card animates to where the card *used* to be, one frame of
      // flicker before the real card jumps under it.
      const previous = queryClient.getQueriesData<Game[]>({ predicate: (query) => isGamesListQuery(query.queryKey) })
      queryClient.setQueriesData<Game[]>({ predicate: (query) => isGamesListQuery(query.queryKey) }, (games) =>
        games?.map((game) => (game.id === id ? patchGame(game, input) : game)),
      )
      await queryClient.cancelQueries({ queryKey: ['games'] })
      return { previous }
    },
    onError: (_err, _vars, context) => {
      context?.previous.forEach(([queryKey, games]) => queryClient.setQueryData(queryKey, games))
    },
    onSuccess: (_game, { input }) => invalidateSavedGame(queryClient, input),
  })
}

/** How a delete still waiting for its toast is sent if the page goes away
 * first, by id: a game deleted on screen must never come back on its own.
 * `pagehide` rather than `beforeunload`, which a page with unsaved changes
 * would ask about first; listened to once for the whole app, since the form
 * a delete came from is gone long before its toast is. */
const sendOnLeave = new Map<number, () => void>()
window.addEventListener('pagehide', () => sendOnLeave.forEach((send) => send()))

/**
 * Deleting a game, with a few seconds to take it back.
 *
 * The game leaves every list at once and a toast offers Undo, but the server
 * only hears of it once the toast has gone: Undo simply puts the game back
 * where it was, as nothing has changed yet. Closing or reloading the page in
 * the meantime sends it right away. If the server refuses it, the game comes
 * back and the toast says why.
 */
export function useDeleteGame() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useCallback(
    (game: Game) => {
      setDeleting(game.id, true)
      void queryClient.cancelQueries({ queryKey: ['games'] })

      let sent = false
      sendOnLeave.set(game.id, () => {
        sent = true
        sendOnLeave.delete(game.id)
        void deleteGame(game.id, true).catch(() => {})
      })

      toast.show({
        message: `Deleted “${game.title}”`,
        action: {
          label: 'Undo',
          onPress: () => {
            sendOnLeave.delete(game.id)
            setDeleting(game.id, false)
          },
        },
        onExpire: () => {
          if (sent) return
          sendOnLeave.delete(game.id)
          deleteGame(game.id)
            // Kept out of the lists until they have been fetched again
            // without it, so that it does not flash back in between.
            .then(() => queryClient.invalidateQueries({ queryKey: ['games'] }))
            .then(
              () => setDeleting(game.id, false),
              (error: unknown) => {
                setDeleting(game.id, false)
                toast.show({ message: `Could not delete “${game.title}”: ${errorMessage(error)}` })
              },
            )
        },
      })
    },
    [queryClient, toast],
  )
}
