// Package repository provides data access on top of GORM.
//
// Repositories return the sentinel errors below rather than driver- or
// GORM-specific ones, so that callers never need to import GORM to tell a
// missing row from a real failure.
package repository

import (
	"errors"
	"fmt"

	"github.com/go-sql-driver/mysql"
	"gorm.io/gorm"
)

var (
	// ErrNotFound is returned when no row matches.
	ErrNotFound = errors.New("not found")
	// ErrDuplicate is returned when a unique constraint rejects the write,
	// typically a repeated name on a genre, developer, publisher or platform.
	ErrDuplicate = errors.New("already exists")
	// ErrInvalidReference is returned when a write points at a row that does
	// not exist, typically a platform, genre, developer or publisher id that
	// was deleted or never existed.
	ErrInvalidReference = errors.New("unknown reference")
	// ErrNotEmpty is returned by a write that is only allowed while a table is
	// empty: creating the very first account.
	ErrNotEmpty = errors.New("not empty")
	// ErrInUse is returned when deleting a record that something still points
	// at: a genre, developer, publisher or platform some game still carries.
	ErrInUse = errors.New("still in use")
	// ErrInvalidSort is returned when a caller asks to sort by an unknown
	// column. Sort fields arrive from query strings and are never interpolated
	// into SQL: they are matched against an allowlist first.
	ErrInvalidSort = errors.New("invalid sort field")
)

const (
	// mysqlDuplicateEntry is error 1062, ER_DUP_ENTRY.
	mysqlDuplicateEntry = 1062
	// mysqlNoReferencedRow is error 1452, ER_NO_REFERENCED_ROW_2: a foreign
	// key points at a row that does not exist.
	mysqlNoReferencedRow = 1452
)

// translate maps GORM and driver errors onto this package's sentinels.
func translate(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNotFound
	}

	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		switch mysqlErr.Number {
		case mysqlDuplicateEntry:
			return fmt.Errorf("%w: %s", ErrDuplicate, mysqlErr.Message)
		case mysqlNoReferencedRow:
			return fmt.Errorf("%w: %s", ErrInvalidReference, mysqlErr.Message)
		}
	}
	return err
}
