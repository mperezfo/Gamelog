package repository_test

import (
	"context"
	"errors"
	"testing"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
)

// seedCatalogue inserts a small, known catalogue for the listing tests.
func seedCatalogue(t *testing.T, f *fixture) (genreID, platformID uint64) {
	t.Helper()
	ctx := context.Background()

	rpg := models.Genre{Name: "RPG"}
	if err := f.genres.Create(ctx, &rpg); err != nil {
		t.Fatalf("creating genre: %v", err)
	}
	pc := models.Platform{Name: "PC"}
	if err := f.platforms.Create(ctx, &pc); err != nil {
		t.Fatalf("creating platform: %v", err)
	}

	games := []struct {
		title  string
		status models.Status
		score  *float64
		logged string
		rpg    bool
		onPC   bool
	}{
		{"Disco Elysium", models.StatusPlayed, ptr(9.8), "2022-03-10", true, true},
		{"Hades", models.StatusPlayed, ptr(9.0), "2021-11-02", true, false},
		{"Silksong", models.StatusWishlist, nil, "", false, true},
		{"Outer Wilds", models.StatusPlaying, ptr(8.5), "2023-01-20", false, true},
	}

	for _, g := range games {
		game := models.Game{Title: g.title, Status: g.status, Score: g.score}
		if g.logged != "" {
			game.LoggedDate = date(t, g.logged)
		}
		if g.onPC {
			game.PlatformID = &pc.ID
		}
		rel := repository.GameRelations{}
		if g.rpg {
			rel.GenreIDs = []uint64{rpg.ID}
		}
		if err := f.games.Create(ctx, &game, rel); err != nil {
			t.Fatalf("creating game %q: %v", g.title, err)
		}
	}

	return rpg.ID, pc.ID
}

func titles(games []models.Game) []string {
	out := make([]string, len(games))
	for i, g := range games {
		out[i] = g.Title
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestGameListFilters(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	genreID, platformID := seedCatalogue(t, f)

	played := models.StatusPlayed

	cases := []struct {
		name   string
		filter repository.GameFilter
		want   []string
	}{
		{
			name:   "no filter sorts by title",
			filter: repository.GameFilter{},
			want:   []string{"Disco Elysium", "Hades", "Outer Wilds", "Silksong"},
		},
		{
			name:   "by status",
			filter: repository.GameFilter{Status: &played},
			want:   []string{"Disco Elysium", "Hades"},
		},
		{
			name:   "by genre",
			filter: repository.GameFilter{GenreID: &genreID},
			want:   []string{"Disco Elysium", "Hades"},
		},
		{
			name:   "by platform",
			filter: repository.GameFilter{PlatformID: &platformID},
			want:   []string{"Disco Elysium", "Outer Wilds", "Silksong"},
		},
		{
			name:   "genre and status combined",
			filter: repository.GameFilter{GenreID: &genreID, Status: &played},
			want:   []string{"Disco Elysium", "Hades"},
		},
		{
			name:   "sorted by score descending",
			filter: repository.GameFilter{Sort: "score", Descending: true},
			want:   []string{"Disco Elysium", "Hades", "Outer Wilds", "Silksong"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			games, err := f.games.List(ctx, tc.filter)
			if err != nil {
				t.Fatalf("List: %v", err)
			}
			if got := titles(games); !equal(got, tc.want) {
				t.Errorf("titles = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestGameListRejectsUnknownSortField(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	// A sort key straight out of a query string must never reach the SQL.
	_, err := f.games.List(ctx, repository.GameFilter{Sort: "title; DROP TABLE games"})
	if !errors.Is(err, repository.ErrInvalidSort) {
		t.Fatalf("err = %v, want ErrInvalidSort", err)
	}

	var count int64
	if err := f.db.Table("games").Count(&count).Error; err != nil {
		t.Fatalf("the games table is gone: %v", err)
	}
}

func TestGameStats(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	seedCatalogue(t, f)

	stats, err := f.games.Stats(ctx, repository.GameFilter{})
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if stats.Count != 4 {
		t.Errorf("Count = %d, want 4", stats.Count)
	}
	// Average over the three scored games: (9.8 + 9.0 + 8.5) / 3.
	if stats.AverageScore == nil {
		t.Fatal("AverageScore = nil, want the average of the scored games")
	}
	if diff := *stats.AverageScore - 9.1; diff > 0.001 || diff < -0.001 {
		t.Errorf("AverageScore = %v, want 9.1", *stats.AverageScore)
	}
	if stats.FirstLoggedDate == nil || stats.FirstLoggedDate.Format("2006-01-02") != "2021-11-02" {
		t.Errorf("FirstLoggedDate = %v, want 2021-11-02", stats.FirstLoggedDate)
	}
	if stats.LastLoggedDate == nil || stats.LastLoggedDate.Format("2006-01-02") != "2023-01-20" {
		t.Errorf("LastLoggedDate = %v, want 2023-01-20", stats.LastLoggedDate)
	}

	played := models.StatusPlayed
	filtered, err := f.games.Stats(ctx, repository.GameFilter{Status: &played})
	if err != nil {
		t.Fatalf("Stats filtered: %v", err)
	}
	if filtered.Count != 2 {
		t.Errorf("filtered Count = %d, want 2", filtered.Count)
	}
}

func TestGameStatusCheckConstraint(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	// models.Status is a string, so an invalid value can reach the database.
	// The CHECK constraint is the last line of defence.
	game := models.Game{Title: "Broken", Status: models.Status("abandoned")}
	err := f.games.Create(ctx, &game, repository.GameRelations{})
	if err == nil {
		t.Fatal("Create accepted an invalid status; the CHECK constraint is not doing its job")
	}
}
