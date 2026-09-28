import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createGame, deleteGame, gameStats, getGame, listGames, updateGame } from '../api/games'
import type { Game, GameFilter, GameInput } from '../types/game'

const gamesKey = (filter: GameFilter = {}) => ['games', filter] as const
const gameKey = (ref: number | string) => ['games', 'detail', ref] as const
const statsKey = (filter: GameFilter = {}) => ['games', 'stats', filter] as const

/** Games matching a filter. An empty filter is the whole library. */
export function useGames(filter: GameFilter = {}) {
  return useQuery({ queryKey: gamesKey(filter), queryFn: () => listGames(filter) })
}

/** The table footer: count, average score, logged-date range. */
export function useGameStats(filter: GameFilter = {}) {
  return useQuery({ queryKey: statsKey(filter), queryFn: () => gameStats(filter) })
}

/** ref is a game's numeric id or its slug. */
export function useGame(ref: number | string | undefined) {
  return useQuery({
    queryKey: gameKey(ref ?? ''),
    queryFn: () => getGame(ref as number | string),
    enabled: ref !== undefined,
  })
}

/** Invalidates every games query: any filter, any stats, any single game. */
function invalidateGames(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['games'] })
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
    release_date: input.release_date ?? null,
    logged_date: input.logged_date ?? null,
    platform_id: input.platform_id ?? null,
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
    onSuccess: () => invalidateGames(queryClient),
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
    onSuccess: () => invalidateGames(queryClient),
  })
}

export function useDeleteGame() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => deleteGame(id),
    onSuccess: () => invalidateGames(queryClient),
  })
}
