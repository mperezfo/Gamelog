package auth

import (
	"strings"
	"sync"
	"time"
)

// How failed logins are held back. A few attempts are free, enough for
// mistyping a password; after them every further failure locks the next
// attempt out for a while, twice as long each time, up to a cap. A lock is
// short enough that a person who mistyped is not locked out for long, and
// grows fast enough that guessing passwords one after another stops being
// practical.
const (
	freeFailures = 5
	firstLock    = 30 * time.Second
	maxLock      = 15 * time.Minute
	// forgetAfter is how long after its last failure a count is dropped, so
	// that nothing is remembered for good. Longer than the longest lock, so
	// that waiting one out does not also wipe the count.
	forgetAfter = 2 * maxLock
	// maxTracked bounds how many counts are kept at once: past it, the one
	// whose last failure is oldest makes room.
	maxTracked = 10_000
	// sweepEvery is how often the expired counts are cleared out, in passing.
	sweepEvery = time.Minute
)

// LoginLimiter counts failed logins for a username from an address, and
// holds further attempts back once there have been too many (see the
// constants above). Counts live in memory: a restart forgets them, and they
// expire on their own. It is safe for concurrent use.
type LoginLimiter struct {
	now func() time.Time

	mu        sync.Mutex
	failures  map[string]*failures
	lastSweep time.Time
}

type failures struct {
	count       int
	last        time.Time
	lockedUntil time.Time
}

// NewLoginLimiter builds a limiter that reads the time from now, which a
// test can turn forward.
func NewLoginLimiter(now func() time.Time) *LoginLimiter {
	return &LoginLimiter{now: now, failures: map[string]*failures{}}
}

// loginKey is what failures are counted against: the username as it is
// compared (ignoring case), and the client's address.
func loginKey(username, address string) string {
	return strings.ToLower(strings.TrimSpace(username)) + "\x00" + address
}

// Wait returns how long a login for username from address has to wait
// before it is tried at all, or zero when it may go ahead.
func (l *LoginLimiter) Wait(username, address string) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	l.sweep(now)
	entry, ok := l.failures[loginKey(username, address)]
	if !ok || !now.Before(entry.lockedUntil) {
		return 0
	}
	return entry.lockedUntil.Sub(now)
}

// Failed counts a failed login, and locks the next ones out once the free
// attempts are used up.
func (l *LoginLimiter) Failed(username, address string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	l.sweep(now)
	key := loginKey(username, address)
	entry, ok := l.failures[key]
	if !ok {
		if len(l.failures) >= maxTracked {
			l.dropOldest()
		}
		entry = &failures{}
		l.failures[key] = entry
	}
	entry.count++
	entry.last = now
	if entry.count >= freeFailures {
		entry.lockedUntil = now.Add(lockFor(entry.count - freeFailures))
	}
}

// Succeeded clears the count of a username from an address.
func (l *LoginLimiter) Succeeded(username, address string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.failures, loginKey(username, address))
}

// lockFor is how long the lock after the nth failure past the free ones
// lasts, counting from zero.
func lockFor(n int) time.Duration {
	lock := firstLock
	for range n {
		lock *= 2
		if lock >= maxLock {
			return maxLock
		}
	}
	return lock
}

// sweep drops the counts whose last failure is long gone, at most once every
// sweepEvery. The caller holds the lock.
func (l *LoginLimiter) sweep(now time.Time) {
	if now.Sub(l.lastSweep) < sweepEvery {
		return
	}
	l.lastSweep = now
	for key, entry := range l.failures {
		if now.Sub(entry.last) >= forgetAfter && !now.Before(entry.lockedUntil) {
			delete(l.failures, key)
		}
	}
}

// dropOldest makes room for one more count. The caller holds the lock.
func (l *LoginLimiter) dropOldest() {
	var oldestKey string
	var oldest time.Time
	for key, entry := range l.failures {
		if oldestKey == "" || entry.last.Before(oldest) {
			oldestKey, oldest = key, entry.last
		}
	}
	delete(l.failures, oldestKey)
}
