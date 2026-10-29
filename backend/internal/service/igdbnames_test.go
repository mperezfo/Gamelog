package service_test

import (
	"context"
	"testing"

	"github.com/mperezfo/gamelog/internal/igdb"
	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
	"github.com/mperezfo/gamelog/internal/service"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

func TestFillIGDBNamesNamesWhatIsMissing(t *testing.T) {
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
	platforms := repository.NewLookupRepository[models.Platform](db, owners[1])

	nintendo := models.Developer{Name: "Nintendo"}
	if err := developers.Create(ctx, &nintendo); err != nil {
		t.Fatalf("creating Nintendo: %v", err)
	}
	devolver := models.Publisher{Name: "Devolver Digital"}
	if err := publishers.Create(ctx, &devolver); err != nil {
		t.Fatalf("creating Devolver Digital: %v", err)
	}
	pc := models.Platform{Name: "PC"}
	if err := platforms.Create(ctx, &pc); err != nil {
		t.Fatalf("creating PC: %v", err)
	}

	// 70 is linked twice, in two accounts, and 900 already has a name.
	if err := developers.LinkIGDB(ctx, []repository.IGDBLink{
		{ID: nintendo.ID, IGDBID: 70}, {ID: nintendo.ID, IGDBID: 900}, {ID: nintendo.ID, IGDBID: 5},
	}); err != nil {
		t.Fatalf("linking developers: %v", err)
	}
	if err := publishers.LinkIGDB(ctx, []repository.IGDBLink{{ID: devolver.ID, IGDBID: 70}}); err != nil {
		t.Fatalf("linking publishers: %v", err)
	}
	if err := platforms.LinkIGDB(ctx, []repository.IGDBLink{{ID: pc.ID, IGDBID: 6}}); err != nil {
		t.Fatalf("linking platforms: %v", err)
	}
	if err := repository.SaveIGDBNames(ctx, db, repository.IGDBCompany,
		[]models.IGDBName{{ID: 900, Name: "Nintendo EPD"}}); err != nil {
		t.Fatalf("naming 900: %v", err)
	}

	var askedCompanies, askedPlatforms [][]uint64
	companies := func(_ context.Context, ids []uint64) ([]igdb.Company, error) {
		askedCompanies = append(askedCompanies, ids)
		out := []igdb.Company{}
		for _, id := range ids {
			// 5 is unknown to IGDB.
			if id == 70 {
				out = append(out, igdb.Company{ID: id, Name: "Nintendo"})
			}
		}
		return out, nil
	}
	lookupPlatforms := func(_ context.Context, ids []uint64) ([]igdb.Platform, error) {
		askedPlatforms = append(askedPlatforms, ids)
		return []igdb.Platform{{ID: 6, Name: "PC (Microsoft Windows)"}}, nil
	}

	named, err := service.FillIGDBNames(ctx, db, companies, lookupPlatforms)
	if err != nil {
		t.Fatalf("naming: %v", err)
	}
	if named != 2 {
		t.Errorf("named %d records, want 70 and 6", named)
	}
	if len(askedCompanies) != 1 || len(askedCompanies[0]) != 2 ||
		askedCompanies[0][0] != 5 || askedCompanies[0][1] != 70 {
		t.Errorf("asked IGDB about companies %v, want once about the unnamed 5 and 70", askedCompanies)
	}
	if len(askedPlatforms) != 1 || len(askedPlatforms[0]) != 1 {
		t.Errorf("asked IGDB about platforms %v, want once about 6", askedPlatforms)
	}

	got, err := developers.Get(ctx, nintendo.ID)
	if err != nil {
		t.Fatalf("reading Nintendo: %v", err)
	}
	want := []models.IGDBName{{ID: 70, Name: "Nintendo"}, {ID: 900, Name: "Nintendo EPD"}}
	if len(got.IGDBNames) != len(want) || got.IGDBNames[0] != want[0] || got.IGDBNames[1] != want[1] {
		t.Errorf("Nintendo reads with igdb_names %+v, want %+v", got.IGDBNames, want)
	}
	if len(got.IGDBCompanyIDs) != 3 {
		t.Errorf("Nintendo reads with igdb_company_ids %v, want all three", got.IGDBCompanyIDs)
	}

	// With everything named that IGDB knows, a second run only asks about
	// the record it does not.
	askedCompanies, askedPlatforms = nil, nil
	named, err = service.FillIGDBNames(ctx, db, companies, lookupPlatforms)
	if err != nil || named != 0 {
		t.Errorf("second run named %d (%v), want nothing", named, err)
	}
	if len(askedCompanies) != 1 || len(askedCompanies[0]) != 1 || askedCompanies[0][0] != 5 || len(askedPlatforms) != 0 {
		t.Errorf("second run asked about companies %v and platforms %v, want only 5", askedCompanies, askedPlatforms)
	}
}
