package steamgriddb

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// newFakeAPI serves the given responses by path, checking that every request
// carries the key.
func newFakeAPI(t *testing.T, responses map[string]string) (*Client, *[]string) {
	t.Helper()

	var requests []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.URL.RequestURI())
		if got := r.Header.Get("Authorization"); got != "Bearer key" {
			t.Errorf("Authorization = %q, want %q", got, "Bearer key")
		}
		response, ok := responses[r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"success":false,"errors":["Game not found"]}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, response)
	}))
	t.Cleanup(server.Close)

	client := New("key")
	client.apiURL = server.URL
	return client, &requests
}

func TestSearchMapsResults(t *testing.T) {
	client, requests := newFakeAPI(t, map[string]string{
		"/search/autocomplete/Resident Evil 4": `{"success":true,"data":[
			{"id":5251,"name":"Resident Evil 4","types":["steam"],"verified":true,"release_date":1679616000},
			{"id":17,"name":"Resident Evil 4 (2005)","types":[],"verified":true}
		]}`,
	})

	games, err := client.Search(context.Background(), "Resident Evil 4")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(games) != 2 {
		t.Fatalf("got %d games, want 2", len(games))
	}
	if games[0].ID != 5251 || games[0].Name != "Resident Evil 4" {
		t.Errorf("first game = %+v", games[0])
	}
	if want := time.Date(2023, 3, 24, 0, 0, 0, 0, time.UTC); games[0].ReleaseDate == nil || !games[0].ReleaseDate.Equal(want) {
		t.Errorf("ReleaseDate = %v, want %v", games[0].ReleaseDate, want)
	}
	if games[1].ReleaseDate != nil {
		t.Errorf("a game with no date has ReleaseDate %v", games[1].ReleaseDate)
	}
	// The title is escaped into the path, not sent as it is.
	if len(*requests) != 1 || (*requests)[0] != "/search/autocomplete/Resident%20Evil%204" {
		t.Errorf("requests = %v", *requests)
	}
}

func TestSearchEscapesASlash(t *testing.T) {
	client, requests := newFakeAPI(t, map[string]string{
		"/search/autocomplete/Fate/stay night": `{"success":true,"data":[]}`,
	})

	games, err := client.Search(context.Background(), "Fate/stay night")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(games) != 0 {
		t.Errorf("games = %v", games)
	}
	if !strings.HasPrefix((*requests)[0], "/search/autocomplete/Fate%2Fstay") {
		t.Errorf("request = %q, want the slash escaped", (*requests)[0])
	}
}

func TestImagesPutHeroesFirstThenPortraitGrids(t *testing.T) {
	client, requests := newFakeAPI(t, map[string]string{
		"/grids/game/5251": `{"success":true,"data":[
			{"id":1,"url":"https://cdn2.steamgriddb.com/grid/wide.png","thumb":"https://cdn2.steamgriddb.com/thumb/wide.jpg","width":920,"height":430},
			{"id":2,"url":"https://cdn2.steamgriddb.com/grid/tall.png","thumb":"https://cdn2.steamgriddb.com/thumb/tall.jpg","width":600,"height":900},
			{"id":3,"url":"https://cdn2.steamgriddb.com/grid/square.png","thumb":"","width":512,"height":512},
			{"id":4,"url":"https://cdn2.steamgriddb.com/grid/tall2.png","thumb":"https://cdn2.steamgriddb.com/thumb/tall2.jpg","width":342,"height":482}
		]}`,
		"/heroes/game/5251": `{"success":true,"data":[
			{"id":5,"url":"https://cdn2.steamgriddb.com/hero/hero.png","thumb":"https://cdn2.steamgriddb.com/thumb/hero.jpg","width":1920,"height":620}
		]}`,
	})

	images, err := client.Images(context.Background(), 5251)
	if err != nil {
		t.Fatalf("Images: %v", err)
	}

	var got []string
	for _, image := range images {
		got = append(got, image.Kind+":"+image.URL[strings.LastIndex(image.URL, "/")+1:])
	}
	want := "hero:hero.png grid:tall.png grid:tall2.png grid:wide.png grid:square.png"
	if strings.Join(got, " ") != want {
		t.Errorf("images = %v, want %s", got, want)
	}
	// An image with no thumbnail falls back on itself.
	if images[4].ThumbURL != images[4].URL {
		t.Errorf("square ThumbURL = %q, want the image itself", images[4].ThumbURL)
	}
	for _, request := range *requests {
		if !strings.Contains(request, "types=static") || !strings.Contains(request, "nsfw=false") {
			t.Errorf("request %q does not leave out animated and NSFW images", request)
		}
	}
}

func TestImagesOfAGameWithNoHeroes(t *testing.T) {
	client, _ := newFakeAPI(t, map[string]string{
		"/grids/game/7": `{"success":true,"data":[{"url":"https://cdn2.steamgriddb.com/grid/a.png","width":600,"height":900}]}`,
	})

	images, err := client.Images(context.Background(), 7)
	if err != nil {
		t.Fatalf("Images: %v", err)
	}
	if len(images) != 1 {
		t.Errorf("images = %v, want the one grid", images)
	}
}

func TestReportsAFailedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"success":false,"errors":["Invalid API key"]}`)
	}))
	defer server.Close()
	client := New("key")
	client.apiURL = server.URL

	_, err := client.Search(context.Background(), "Celeste")
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Errorf("err = %v, want one naming the status", err)
	}
}
