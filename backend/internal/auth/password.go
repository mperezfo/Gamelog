package auth

import (
	"fmt"
	"sync"

	"golang.org/x/crypto/bcrypt"
)

const (
	// MinPasswordLength is the one rule there is. No character classes, no
	// expiry: length is the only requirement that reliably buys anything, and
	// the rest just pushes people towards worse passwords they write down.
	MinPasswordLength = 8
	// MaxPasswordLength is bcrypt's own limit. It ignores everything past 72
	// bytes, so a longer password is rejected rather than silently truncated
	// into a shorter one the user does not know they have.
	MaxPasswordLength = 72
)

// ErrWeakPassword is returned for a password that does not meet the length
// rules above.
var ErrWeakPassword = fmt.Errorf(
	"a password must be between %d and %d characters", MinPasswordLength, MaxPasswordLength)

// HashPassword returns the bcrypt hash to store for a password.
func HashPassword(password string) (string, error) {
	if len(password) < MinPasswordLength || len(password) > MaxPasswordLength {
		return "", ErrWeakPassword
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hashing a password: %w", err)
	}
	return string(hash), nil
}

// comparePassword reports whether a password matches a stored hash.
//
// A hash bcrypt cannot parse comes back as a mismatch rather than as an error,
// which is the safe reading: a row with a corrupted hash must not turn into a
// way in, and there is nothing a caller could usefully do about it anyway.
func comparePassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// decoyHash is a valid bcrypt hash of a password nobody has.
//
// It exists so that logging in with an unknown username costs the same bcrypt
// comparison as logging in with a wrong password, and the two cannot be told
// apart by how long the answer takes. It is computed once, lazily, because
// generating it costs the same as a real hash.
var decoyHash = sync.OnceValue(func() string {
	hash, err := bcrypt.GenerateFromPassword([]byte("a password nobody has"), bcrypt.DefaultCost)
	if err != nil {
		// Unreachable for a fixed, valid input.
		return ""
	}
	return string(hash)
})
