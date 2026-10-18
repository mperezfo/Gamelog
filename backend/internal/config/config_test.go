package config

import "testing"

func TestIGDBCredentialsGoTogether(t *testing.T) {
	tests := []struct {
		id, secret  string
		wantErr     bool
		wantEnabled bool
	}{
		{"", "", false, false},
		{"id", "secret", false, true},
		{"id", "", true, false},
		{"", "secret", true, false},
	}
	for _, test := range tests {
		t.Setenv("GAMELOG_IGDB_CLIENT_ID", test.id)
		t.Setenv("GAMELOG_IGDB_CLIENT_SECRET", test.secret)

		cfg, err := Load("")
		if (err != nil) != test.wantErr {
			t.Errorf("id %q, secret %q: err = %v, want an error: %v", test.id, test.secret, err, test.wantErr)
			continue
		}
		if err == nil && cfg.IGDBEnabled() != test.wantEnabled {
			t.Errorf("id %q, secret %q: IGDBEnabled = %v, want %v", test.id, test.secret, cfg.IGDBEnabled(), test.wantEnabled)
		}
	}
}
