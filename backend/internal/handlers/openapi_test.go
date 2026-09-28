package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
	"github.com/mperezfo/gamelog/internal/router"
	"github.com/mperezfo/gamelog/internal/service"
)

// get performs a request against a router built for the test.
func get(handler http.Handler, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

// openAPI returns the generated document, decoded.
func openAPI(t *testing.T) map[string]any {
	t.Helper()

	rec := get(newRouter(t, nil, false), router.OpenAPIPath+".json")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var spec map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&spec); err != nil {
		t.Fatalf("the OpenAPI document is not valid JSON: %v", err)
	}
	return spec
}

func TestOpenAPIDocumentDescribesEveryOperation(t *testing.T) {
	spec := openAPI(t)

	if version, _ := spec["openapi"].(string); !strings.HasPrefix(version, "3.1") {
		t.Errorf("openapi = %v, want a 3.1 document", spec["openapi"])
	}

	paths, ok := spec["paths"].(map[string]any)
	if !ok {
		t.Fatal("the document has no paths")
	}

	want := []string{
		"/api/health",
		"/api/games", "/api/games/{id}", "/api/games/stats",
		"/api/genres", "/api/genres/{id}",
		"/api/developers", "/api/developers/{id}",
		"/api/publishers", "/api/publishers/{id}",
		"/api/platforms", "/api/platforms/{id}",
		"/api/export", "/api/import",
	}
	for _, path := range want {
		if _, ok := paths[path]; !ok {
			t.Errorf("%s is missing from the OpenAPI document", path)
		}
	}

	// Everything the backend serves lives under /api.
	for path := range paths {
		if !strings.HasPrefix(path, "/api/") {
			t.Errorf("%s is served outside /api", path)
		}
	}
}

func TestOpenAPIDocumentHasNoServersList(t *testing.T) {
	// With no servers, a client resolves the paths against the origin that
	// served the document, which is what keeps one document correct in
	// development, in a test deployment and in production.
	if servers, ok := openAPI(t)["servers"]; ok {
		t.Errorf("servers = %v, want the document to carry none", servers)
	}
}

func TestOpenAPIStatusEnumComesFromTheModels(t *testing.T) {
	want := make([]any, 0, len(models.Statuses()))
	for _, status := range models.Statuses() {
		want = append(want, string(status))
	}

	schemas := findSchemas(openAPI(t), "Status")
	if len(schemas) == 0 {
		t.Fatal("no schema titled Status in the OpenAPI document")
	}

	for _, schema := range schemas {
		if got := schema["enum"]; !reflect.DeepEqual(got, want) {
			t.Errorf("status enum = %v, want %v", got, want)
		}
	}
}

func TestOpenAPISortEnumMatchesTheRepository(t *testing.T) {
	// The sort values are declared as a struct tag, which cannot be built from
	// repository.SortFields() at compile time. This is what keeps the two in
	// sync: adding a sortable column without documenting it fails here.
	parameter := findParameter(t, openAPI(t), "get", "/api/games", "sort")

	schema, _ := parameter["schema"].(map[string]any)
	values, _ := schema["enum"].([]any)

	got := make([]string, 0, len(values))
	for _, value := range values {
		got = append(got, value.(string))
	}
	slices.Sort(got)

	want := repository.SortFields()
	slices.Sort(want)

	if !slices.Equal(got, want) {
		t.Errorf("sort enum = %v, want %v", got, want)
	}
}

func TestOpenAPIImportModeEnumMatchesTheService(t *testing.T) {
	// Same reason as the sort enum above: the accepted modes are a struct tag,
	// which cannot be built from service.Modes() at compile time.
	parameter := findParameter(t, openAPI(t), "post", "/api/import", "mode")

	schema, _ := parameter["schema"].(map[string]any)
	values, _ := schema["enum"].([]any)

	got := make([]string, 0, len(values))
	for _, value := range values {
		got = append(got, value.(string))
	}
	slices.Sort(got)

	want := make([]string, 0, len(service.Modes()))
	for _, mode := range service.Modes() {
		want = append(want, string(mode))
	}
	slices.Sort(want)

	if !slices.Equal(got, want) {
		t.Errorf("mode enum = %v, want %v", got, want)
	}
}

func TestDocsAreServed(t *testing.T) {
	page := get(newRouter(t, nil, true), router.DocsPath)
	if page.Code != http.StatusOK {
		t.Fatalf("%s: status = %d, want %d", router.DocsPath, page.Code, http.StatusOK)
	}

	body := page.Body.String()
	if !strings.Contains(body, "<elements-api") {
		t.Error("the documentation page is not the Stoplight Elements one")
	}
	// The console is only useful if it reads this deployment's document.
	if !strings.Contains(body, router.OpenAPIPath+".yaml") {
		t.Errorf("the documentation page does not point at %s.yaml", router.OpenAPIPath)
	}
	// Serving the page ourselves rather than letting Huma render it buys one
	// thing, and this is it: the page belongs to this deployment rather than to
	// the tool that draws it.
	if !strings.Contains(body, `a[href*="stoplight.io"]`) {
		t.Error("the documentation page still carries the mark of its renderer")
	}
}

func TestDocsCanBeDisabledWithoutHidingTheDocument(t *testing.T) {
	handler := newRouter(t, nil, false)

	if page := get(handler, router.DocsPath); page.Code != http.StatusNotFound {
		t.Errorf("%s: status = %d, want %d", router.DocsPath, page.Code, http.StatusNotFound)
	}

	// The document describes the API, it does not grant access to it, so it
	// stays available for client and type generation.
	for _, path := range []string{router.OpenAPIPath + ".json", router.OpenAPIPath + ".yaml"} {
		if rec := get(handler, path); rec.Code != http.StatusOK {
			t.Errorf("%s: status = %d, want %d", path, rec.Code, http.StatusOK)
		}
	}
}

// findSchemas collects every schema in the document carrying the given title.
func findSchemas(node any, title string) []map[string]any {
	var found []map[string]any

	switch value := node.(type) {
	case map[string]any:
		if got, ok := value["title"].(string); ok && got == title {
			found = append(found, value)
		}
		for _, child := range value {
			found = append(found, findSchemas(child, title)...)
		}
	case []any:
		for _, child := range value {
			found = append(found, findSchemas(child, title)...)
		}
	}

	return found
}

// findParameter returns the named query parameter of an operation.
func findParameter(t *testing.T, spec map[string]any, method, path, name string) map[string]any {
	t.Helper()

	paths, _ := spec["paths"].(map[string]any)
	item, _ := paths[path].(map[string]any)
	operation, _ := item[method].(map[string]any)
	parameters, _ := operation["parameters"].([]any)

	for _, raw := range parameters {
		parameter, _ := raw.(map[string]any)
		if got, _ := parameter["name"].(string); got == name {
			return parameter
		}
	}

	t.Fatalf("%s %s has no %q parameter", strings.ToUpper(method), path, name)
	return nil
}
