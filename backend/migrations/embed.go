// Package migrations embeds the SQL schema migrations into the binary, so that
// deploying the application never requires a separate migration tool or files
// mounted next to it.
//
// The layout (migrations at backend/migrations) follows the spec, and
// go:embed cannot reach outside its own directory, which is why this package
// exists rather than embedding from internal/database.
package migrations

import "embed"

// FS holds every .sql migration, named <version>_<description>.sql.
//
//go:embed *.sql
var FS embed.FS
