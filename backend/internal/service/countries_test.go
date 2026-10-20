package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/mperezfo/gamelog/internal/igdb"
	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
	"github.com/mperezfo/gamelog/internal/service"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

func TestBackfillCompanyCountriesRunsOnce(t *testing.T) {
	ctx := context.Background()
	db := testsupport.NewDatabase(t)

	users := repository.NewUserRepository(db)
	var owners []uint64
	for _, name := range []string{"alice", "bob"} {
		user := &models.User{Username: name, PasswordHash: "not a real hash"}
		if err := users.Create(ctx, user); err != nil {
			t.Fatalf("creating %s: %v", name, err)
		}
		owners = append(owners, user.ID)
	}

	developers := repository.NewLookupRepository[models.Developer](db, owners[0])
	publishers := repository.NewLookupRepository[models.Publisher](db, owners[1])
	jp := "JP"

	create := func(developer models.Developer) uint64 {
		t.Helper()
		if err := developers.Create(ctx, &developer); err != nil {
			t.Fatalf("creating %s: %v", developer.Name, err)
		}
		return developer.ID
	}
	nintendo := create(models.Developer{Name: "Nintendo"})
	capcom := create(models.Developer{Name: "Capcom", Country: &jp})
	unknown := create(models.Developer{Name: "Nobody Knows"})
	unlinked := create(models.Developer{Name: "Not Linked"})

	devolver := models.Publisher{Name: "Devolver Digital"}
	if err := publishers.Create(ctx, &devolver); err != nil {
		t.Fatalf("creating Devolver Digital: %v", err)
	}

	// Nintendo stands for two IGDB companies: the lower id's country wins,
	// whatever order the links were made in.
	if err := developers.LinkIGDB(ctx, []repository.IGDBLink{
		{ID: nintendo, IGDBID: 900}, {ID: nintendo, IGDBID: 70},
		{ID: capcom, IGDBID: 37}, {ID: unknown, IGDBID: 5},
	}); err != nil {
		t.Fatalf("linking developers: %v", err)
	}
	if err := publishers.LinkIGDB(ctx, []repository.IGDBLink{{ID: devolver.ID, IGDBID: 300}}); err != nil {
		t.Fatalf("linking publishers: %v", err)
	}

	var asked [][]uint64
	companies := func(_ context.Context, ids []uint64) ([]igdb.Company, error) {
		asked = append(asked, ids)
		known := map[uint64]string{70: "JP", 900: "US", 37: "US", 300: "US"}
		out := []igdb.Company{}
		for _, id := range ids {
			out = append(out, igdb.Company{ID: id, Name: "Company", Country: known[id]})
		}
		return out, nil
	}

	filled, err := service.BackfillCompanyCountries(ctx, db, companies, time.Now())
	if err != nil {
		t.Fatalf("backfilling: %v", err)
	}
	if filled != 2 {
		t.Errorf("filled %d records, want Nintendo and Devolver Digital", filled)
	}
	// Capcom already has a country, so IGDB is not asked about it.
	if len(asked) != 1 || len(asked[0]) != 4 {
		t.Errorf("asked IGDB about %v, want one request for the companies of the records with no country", asked)
	}

	want := map[uint64]string{nintendo: "JP", capcom: "JP", unknown: "", unlinked: ""}
	for id, country := range want {
		got, err := developers.Get(ctx, id)
		if err != nil {
			t.Fatalf("reading developer %d: %v", id, err)
		}
		if (got.Country == nil && country != "") || (got.Country != nil && *got.Country != country) {
			t.Errorf("%s: country = %v, want %q", got.Name, got.Country, country)
		}
	}
	got, err := publishers.Get(ctx, devolver.ID)
	if err != nil || got.Country == nil || *got.Country != "US" {
		t.Errorf("Devolver Digital: country = %v (%v), want US, in another account", got.Country, err)
	}

	// Once done, never again, even with countries missing.
	asked = nil
	filled, err = service.BackfillCompanyCountries(ctx, db, companies, time.Now())
	if err != nil || filled != 0 || len(asked) != 0 {
		t.Errorf("second run filled %d (%v) after asking %v, want it to do nothing", filled, err, asked)
	}
}
