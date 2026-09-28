import { useNavigate, useParams } from 'react-router-dom'

import { errorMessage } from '../api/client'
import { GameForm } from '../components/GameForm'
import { Notice } from '../components/Notice'
import { PageContainer } from '../components/PageContainer'
import { useGame } from '../hooks/useGames'

/**
 * A game's own page: what a search result, a bookmark or a shared link lands
 * on. Editing here is the same `GameForm` the slide-over uses, just with
 * nothing behind it to return to but the games table.
 */
export function GameDetail() {
  // Named "id" in the route for history's sake, but it is really a slug now
  // (or, for an old bookmark, still a numeric id — the API accepts either).
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()

  const game = useGame(params.id)

  if (game.isPending) {
    return (
      <PageContainer>
        <p className="text-[13px] text-ink-faint">Loading…</p>
      </PageContainer>
    )
  }

  if (game.isError || !game.data) {
    return (
      <PageContainer>
        <Notice tone="error">
          {game.error ? errorMessage(game.error) : 'No game with that id.'}
        </Notice>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <h1 className="mb-6 text-lg font-semibold tracking-tight text-ink">{game.data.title}</h1>
      <GameForm
        game={game.data}
        onSaved={() => navigate('/games')}
        onDeleted={() => navigate('/games')}
        onCancel={() => navigate('/games')}
      />
    </PageContainer>
  )
}
