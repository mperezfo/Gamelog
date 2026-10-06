package notify_test

import (
	"context"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/notify"
	"github.com/mperezfo/gamelog/internal/repository"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

// schedulerFixture is a scheduler over a real database, sending through a
// fake ntfy server.
type schedulerFixture struct {
	t         *testing.T
	db        *gorm.DB
	scheduler *notify.Scheduler
	received  *[]published
	userID    uint64
}

func newSchedulerFixture(t *testing.T, hour int) *schedulerFixture {
	t.Helper()

	db := testsupport.NewDatabase(t)
	url, received, _ := fakeNtfy(t, 200)

	user := &models.User{Username: "player", PasswordHash: "x"}
	if err := repository.NewUserRepository(db).Create(context.Background(), user); err != nil {
		t.Fatalf("creating the account: %v", err)
	}

	return &schedulerFixture{
		t:         t,
		db:        db,
		scheduler: notify.NewScheduler(db, notify.NewRegistry(notify.Options{NtfyURL: url}), hour),
		received:  received,
		userID:    user.ID,
	}
}

// channel saves the account's ntfy channel.
func (f *schedulerFixture) channel(enabled bool, daysBefore int) {
	f.t.Helper()
	err := repository.NewNotificationRepository(f.db, f.userID).Save(context.Background(), &models.NotificationChannel{
		Type: "ntfy", Enabled: enabled, DaysBefore: daysBefore, Settings: `{"topic":"mine"}`,
	})
	if err != nil {
		f.t.Fatalf("saving the channel: %v", err)
	}
}

// game adds a game of the account's coming out in days days from day.
func (f *schedulerFixture) game(title string, status models.Status, day time.Time, days int) uint64 {
	f.t.Helper()
	release := day.AddDate(0, 0, days)
	game := &models.Game{
		UserID:      &f.userID,
		Title:       title,
		Slug:        title,
		Status:      status,
		ReleaseDate: &release,
	}
	if err := f.db.Create(game).Error; err != nil {
		f.t.Fatalf("creating %q: %v", title, err)
	}
	return game.ID
}

func (f *schedulerFixture) tick(at time.Time) {
	f.t.Helper()
	if err := f.scheduler.Tick(context.Background(), at); err != nil {
		f.t.Fatalf("tick: %v", err)
	}
}

func (f *schedulerFixture) titles() []string {
	var titles []string
	for _, p := range *f.received {
		titles = append(titles, p.Title)
	}
	return titles
}

// utc is midnight of a calendar day. Release dates are dates, so the tests
// speak in them.
func utc(year int, month time.Month, day int) time.Time {
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

func TestSchedulerRemindsWithinTheWindowAndOnTheDay(t *testing.T) {
	f := newSchedulerFixture(t, 9)
	f.channel(true, 3)
	day := utc(2026, time.October, 6)

	f.game("Today", models.StatusWishlist, day, 0)
	f.game("Tomorrow", models.StatusPending, day, 1)
	f.game("InThreeDays", models.StatusWishlist, day, 3)
	f.game("InFourDays", models.StatusWishlist, day, 4)
	f.game("Yesterday", models.StatusWishlist, day, -1)
	f.game("AlreadyPlayed", models.StatusPlayed, day, 1)

	f.tick(day.Add(10 * time.Hour))

	got := f.titles()
	want := map[string]bool{"Today": true, "Tomorrow": true, "InThreeDays": true}
	if len(got) != len(want) {
		t.Fatalf("sent %v, want exactly %v", got, want)
	}
	for _, title := range got {
		if !want[title] {
			t.Errorf("sent a reminder for %q, which is outside the window or already played", title)
		}
	}

	bodies := map[string]string{}
	for _, p := range *f.received {
		bodies[p.Title] = p.Message
	}
	if bodies["Today"] != "Out today!" {
		t.Errorf("message for a game out today = %q", bodies["Today"])
	}
	if bodies["Tomorrow"] != "Comes out tomorrow, Oct 7, 2026." {
		t.Errorf("message for a game out tomorrow = %q", bodies["Tomorrow"])
	}
	if bodies["InThreeDays"] != "Comes out in 3 days, Oct 9, 2026." {
		t.Errorf("message for a game out in three days = %q", bodies["InThreeDays"])
	}
}

func TestSchedulerSendsEachReminderOnce(t *testing.T) {
	f := newSchedulerFixture(t, 9)
	f.channel(true, 3)
	day := utc(2026, time.October, 6)
	f.game("Soon", models.StatusWishlist, day, 2)

	f.tick(day.Add(10 * time.Hour))
	f.tick(day.Add(11 * time.Hour))
	if len(*f.received) != 1 {
		t.Fatalf("sent %d reminders after two ticks on the same day, want 1", len(*f.received))
	}

	// The next day it is a different reminder: the release is a day closer,
	// but the one about being within the window has already gone out.
	f.tick(day.AddDate(0, 0, 1).Add(10 * time.Hour))
	if len(*f.received) != 1 {
		t.Errorf("sent %d reminders after the next day, want still 1", len(*f.received))
	}

	// And on the day itself it is announced once more.
	f.tick(day.AddDate(0, 0, 2).Add(10 * time.Hour))
	f.tick(day.AddDate(0, 0, 2).Add(12 * time.Hour))
	if len(*f.received) != 2 {
		t.Errorf("sent %d reminders once the game is out, want 2 (advance and release day)", len(*f.received))
	}
}

func TestSchedulerAnnouncesAMovedDateAgain(t *testing.T) {
	f := newSchedulerFixture(t, 9)
	f.channel(true, 3)
	day := utc(2026, time.October, 6)
	id := f.game("Delayed", models.StatusWishlist, day, 2)

	f.tick(day.Add(10 * time.Hour))

	moved := day.AddDate(0, 0, 3)
	if err := f.db.Model(&models.Game{}).Where("id = ?", id).Update("release_date", moved).Error; err != nil {
		t.Fatalf("moving the date: %v", err)
	}
	f.tick(day.Add(11 * time.Hour))

	if len(*f.received) != 2 {
		t.Errorf("sent %d reminders, want 2: one per release date", len(*f.received))
	}
}

func TestSchedulerWaitsForTheHour(t *testing.T) {
	f := newSchedulerFixture(t, 9)
	f.channel(true, 3)
	day := utc(2026, time.October, 6)
	f.game("Soon", models.StatusWishlist, day, 1)

	f.tick(day.Add(8*time.Hour + 59*time.Minute))
	if len(*f.received) != 0 {
		t.Fatalf("sent %d reminders before the hour, want none", len(*f.received))
	}

	f.tick(day.Add(9 * time.Hour))
	if len(*f.received) != 1 {
		t.Errorf("sent %d reminders at the hour, want 1", len(*f.received))
	}
}

func TestSchedulerIgnoresChannelsSwitchedOff(t *testing.T) {
	f := newSchedulerFixture(t, 0)
	f.channel(false, 3)
	day := utc(2026, time.October, 6)
	f.game("Soon", models.StatusWishlist, day, 1)

	f.tick(day.Add(10 * time.Hour))
	if len(*f.received) != 0 {
		t.Errorf("sent %d reminders through a channel that is off, want none", len(*f.received))
	}
}

func TestSchedulerWithZeroDaysOnlyAnnouncesTheDay(t *testing.T) {
	f := newSchedulerFixture(t, 0)
	f.channel(true, 0)
	day := utc(2026, time.October, 6)
	f.game("Today", models.StatusWishlist, day, 0)
	f.game("Tomorrow", models.StatusWishlist, day, 1)

	f.tick(day.Add(10 * time.Hour))
	if got := f.titles(); len(got) != 1 || got[0] != "Today" {
		t.Errorf("sent %v, want only Today", got)
	}
}

func TestSchedulerKeepsSendingAfterAFailure(t *testing.T) {
	f := newSchedulerFixture(t, 0)
	f.channel(true, 3)
	day := utc(2026, time.October, 6)
	f.game("Soon", models.StatusWishlist, day, 1)

	// Break the channel's topic so that every delivery fails, and make sure the
	// failure neither aborts the tick nor is remembered as a delivery.
	err := repository.NewNotificationRepository(f.db, f.userID).Save(context.Background(), &models.NotificationChannel{
		Type: "ntfy", Enabled: true, DaysBefore: 3, Settings: `{"topic":"not valid!"}`,
	})
	if err != nil {
		t.Fatalf("saving: %v", err)
	}
	f.tick(day.Add(10 * time.Hour))

	f.channel(true, 3)
	f.tick(day.Add(11 * time.Hour))
	if len(*f.received) != 1 {
		t.Errorf("sent %d reminders, want 1: the failed attempt must not count as sent", len(*f.received))
	}
}
