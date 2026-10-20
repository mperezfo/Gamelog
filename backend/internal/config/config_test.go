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

func TestIGDBSearchLimit(t *testing.T) {
	tests := []struct {
		value   string
		want    int
		wantErr bool
	}{
		{"", 10, false},
		{"25", 25, false},
		{"1", 1, false},
		{"500", 500, false},
		{"0", 0, true},
		{"501", 0, true},
		{"-3", 0, true},
		{"ten", 0, true},
	}
	for _, test := range tests {
		t.Setenv("GAMELOG_IGDB_SEARCH_LIMIT", test.value)

		cfg, err := Load("")
		if (err != nil) != test.wantErr {
			t.Errorf("%q: err = %v, want an error: %v", test.value, err, test.wantErr)
			continue
		}
		if err == nil && cfg.IGDBSearchLimit != test.want {
			t.Errorf("%q: IGDBSearchLimit = %d, want %d", test.value, cfg.IGDBSearchLimit, test.want)
		}
	}
}

func TestSteamGridDBKeyIsOptional(t *testing.T) {
	for _, key := range []string{"", "key"} {
		t.Setenv("GAMELOG_STEAMGRIDDB_API_KEY", key)

		cfg, err := Load("")
		if err != nil {
			t.Fatalf("key %q: %v", key, err)
		}
		if want := key != ""; cfg.SteamGridDBEnabled() != want {
			t.Errorf("key %q: SteamGridDBEnabled = %v, want %v", key, cfg.SteamGridDBEnabled(), want)
		}
	}
}
