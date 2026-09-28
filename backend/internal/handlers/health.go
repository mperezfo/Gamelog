package handlers

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/auth"
	"github.com/mperezfo/gamelog/internal/database"
)

// healthBody is the body of GET /api/health.
type healthBody struct {
	Status   string    `json:"status" enum:"ok,degraded" doc:"Overall state of the service."`
	Service  string    `json:"service" doc:"Name of the service answering, to tell deployments apart."`
	Version  string    `json:"version" doc:"Version of the running deployment: a git tag, or a short commit hash when the build has none."`
	Database string    `json:"database" enum:"ok,unreachable" doc:"State of the database connection."`
	Time     time.Time `json:"time" doc:"Current instant, in UTC."`
}

// healthOutput carries the status code explicitly: the same body is returned
// with a 503 when the database is unreachable.
type healthOutput struct {
	Status int
	Body   healthBody
}

// registerHealth registers the health check.
//
// It answers 503 when the database is unreachable, so that the compose
// healthcheck and any uptime monitor see a real failure rather than a process
// that is up but unable to serve anything.
func registerHealth(api huma.API, db *gorm.DB, version string) {
	huma.Register(api, huma.Operation{
		OperationID: "get-health",
		Method:      http.MethodGet,
		Path:        "/api/health",
		Summary:     "Health check",
		Description: "Reports whether the process and its database are usable. " +
			"Answers 503 with the same body, and `status: degraded`, when the " +
			"database cannot be reached.",
		Tags: []string{"Service"},
		// Public: a health check that needs a session cannot be read by the
		// compose healthcheck or by an uptime monitor.
		Metadata: auth.Require(auth.AccessPublic),
	}, func(ctx context.Context, _ *struct{}) (*healthOutput, error) {
		out := &healthOutput{
			Status: http.StatusOK,
			Body: healthBody{
				Status:   "ok",
				Service:  "gamelog",
				Version:  version,
				Database: "ok",
				Time:     time.Now().UTC(),
			},
		}

		if err := database.Ping(ctx, db); err != nil {
			slog.Error("health check: database unreachable", "error", err)
			out.Status = http.StatusServiceUnavailable
			out.Body.Status = "degraded"
			out.Body.Database = "unreachable"
		}

		return out, nil
	})

	// The 503 is not an error response: it carries the same body as the 200,
	// describing what is wrong. Reusing the generated content keeps the schema
	// reference from going stale.
	operation := api.OpenAPI().Paths["/api/health"].Get
	operation.Responses["503"] = &huma.Response{
		Description: "The database is unreachable.",
		Content:     operation.Responses["200"].Content,
	}
}
