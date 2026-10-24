package auth

import (
	"fmt"
	"testing"
	"time"
)

// clock is a time a test turns forward by hand.
type clock struct{ now time.Time }

func (c *clock) Now() time.Time           { return c.now }
func (c *clock) advance(by time.Duration) { c.now = c.now.Add(by) }
func newClock() *clock                    { return &clock{now: time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)} }

func TestLoginLimiterLocksAfterTheFreeAttempts(t *testing.T) {
	c := newClock()
	limiter := NewLoginLimiter(c.Now)

	for i := range freeFailures - 1 {
		limiter.Failed("martin", "192.0.2.1")
		if wait := limiter.Wait("martin", "192.0.2.1"); wait != 0 {
			t.Fatalf("after %d failures wait = %v, want none", i+1, wait)
		}
	}

	limiter.Failed("martin", "192.0.2.1")
	if wait := limiter.Wait("MARTIN", "192.0.2.1"); wait != firstLock {
		t.Errorf("after %d failures wait = %v, want %v whatever the case of the username", freeFailures, wait, firstLock)
	}
	// Someone else, or the same name from another address, is not held back.
	if wait := limiter.Wait("martin", "192.0.2.2"); wait != 0 {
		t.Errorf("another address waits %v, want none", wait)
	}
	if wait := limiter.Wait("ana", "192.0.2.1"); wait != 0 {
		t.Errorf("another username waits %v, want none", wait)
	}

	c.advance(firstLock)
	if wait := limiter.Wait("martin", "192.0.2.1"); wait != 0 {
		t.Errorf("once the lock is over wait = %v, want none", wait)
	}

	// Every further failure doubles the lock, up to the cap.
	want := firstLock
	for range 8 {
		limiter.Failed("martin", "192.0.2.1")
		want = min(want*2, maxLock)
		if wait := limiter.Wait("martin", "192.0.2.1"); wait != want {
			t.Fatalf("wait = %v, want %v", wait, want)
		}
		c.advance(want)
	}
}

func TestLoginLimiterForgets(t *testing.T) {
	c := newClock()
	limiter := NewLoginLimiter(c.Now)

	for range freeFailures {
		limiter.Failed("martin", "192.0.2.1")
	}
	limiter.Succeeded("martin", "192.0.2.1")
	if wait := limiter.Wait("martin", "192.0.2.1"); wait != 0 {
		t.Errorf("after a success wait = %v, want none", wait)
	}

	for range freeFailures - 1 {
		limiter.Failed("martin", "192.0.2.1")
	}
	c.advance(forgetAfter)
	limiter.Failed("martin", "192.0.2.1")
	if wait := limiter.Wait("martin", "192.0.2.1"); wait != 0 {
		t.Errorf("a failure after the count expired waits %v, want it counted from scratch", wait)
	}
	if len(limiter.failures) != 1 {
		t.Errorf("%d counts kept, want the expired ones swept", len(limiter.failures))
	}
}

func TestLoginLimiterIsBounded(t *testing.T) {
	c := newClock()
	limiter := NewLoginLimiter(c.Now)

	for i := range maxTracked + 10 {
		limiter.Failed(fmt.Sprintf("user%d", i), "192.0.2.1")
		c.advance(time.Millisecond)
	}
	if len(limiter.failures) != maxTracked {
		t.Errorf("%d counts kept, want at most %d", len(limiter.failures), maxTracked)
	}
	if _, ok := limiter.failures[loginKey("user0", "192.0.2.1")]; ok {
		t.Error("the oldest count was kept, want it dropped to make room")
	}
}
