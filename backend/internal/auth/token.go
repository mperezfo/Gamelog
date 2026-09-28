package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

// tokenBytes is the size of a session token before encoding. 32 bytes of
// randomness is far past anything guessable.
const tokenBytes = 32

// newToken returns a fresh session token and the hash to store for it.
//
// The encoding is URL-safe base64 without padding, which is exactly the
// alphabet a cookie value may carry without quoting.
func newToken() (token string, hash []byte, err error) {
	raw := make([]byte, tokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("generating a session token: %w", err)
	}

	token = base64.RawURLEncoding.EncodeToString(raw)
	return token, HashToken(token), nil
}

// HashToken is what gets stored for a session.
//
// A plain SHA-256 rather than a password hash is the right choice here: the
// token is 32 random bytes, so there is no dictionary to slow an attacker
// down with. The hash exists so that a leaked copy of the sessions table does
// not hand over live sessions, and for that one pass is enough.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
