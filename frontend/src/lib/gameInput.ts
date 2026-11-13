import type { Game, GameInput } from '../types/game'

/** A game as it stands, in the shape a save of it sends, with `changes`
 * applied: for a save that changes a field or two (a move on the board, a
 * release date from IGDB) and leaves the rest exactly as it is. */
export function gameInput(game: Game, changes: Partial<GameInput> = {}): GameInput {
  return {
    title: game.title,
    status: game.status,
    position: game.position,
    score: game.score,
    tagline: game.tagline,
    notes: game.notes,
    cover_image_url: game.cover_image_url,
    cover_focal_x: game.cover_focal_x,
    cover_focal_y: game.cover_focal_y,
    cover_zoom: game.cover_zoom,
    release_date: game.release_date,
    logged_date: game.logged_date,
    platform_id: game.platform_id,
    igdb_id: game.igdb_id,
    genre_ids: (game.genres ?? []).map((g) => g.id),
    developer_ids: (game.developers ?? []).map((d) => d.id),
    publisher_ids: (game.publishers ?? []).map((p) => p.id),
    ...changes,
  }
}
