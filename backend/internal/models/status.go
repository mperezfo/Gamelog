package models

// Status is the lifecycle stage of a game.
//
// The set is fixed: the application behaves differently per status (score is
// null while a game is unplayed, rankings only consider played games, the
// Kanban columns follow the order below), so a new status always implies a
// code change. Adding one is a migration plus a constant here.
type Status string

const (
	// StatusWishlist: wanted, but not in the active rotation.
	StatusWishlist Status = "wishlist"
	// StatusPending: in the backlog, waiting to be started.
	StatusPending Status = "pending"
	// StatusPlaying: in progress.
	StatusPlaying Status = "playing"
	// StatusPlayed: finished.
	StatusPlayed Status = "played"
)

// statusOrder is the Kanban column order. It doubles as the set of
// valid values, and must stay in sync with the chk_games_status constraint.
var statusOrder = []Status{StatusWishlist, StatusPending, StatusPlaying, StatusPlayed}

// Statuses returns every valid status in Kanban column order.
func Statuses() []Status {
	out := make([]Status, len(statusOrder))
	copy(out, statusOrder)
	return out
}

// Valid reports whether s is one of the known statuses.
func (s Status) Valid() bool {
	for _, known := range statusOrder {
		if s == known {
			return true
		}
	}
	return false
}

// String implements fmt.Stringer.
func (s Status) String() string { return string(s) }
