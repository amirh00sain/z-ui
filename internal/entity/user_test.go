package entity

import (
	"testing"
	"time"
)

func TestUserEffectiveActive(t *testing.T) {
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	past := now.Add(-time.Hour)
	future := now.Add(time.Hour)

	cases := []struct {
		name      string
		active    bool
		expiresAt *time.Time
		expired   bool
		effective bool
	}{
		{"enabled_no_expiry", true, nil, false, true},
		{"enabled_not_expired", true, &future, false, true},
		{"enabled_expired", true, &past, true, false},
		{"enabled_just_expired", true, &now, true, false},
		{"disabled_not_expired", false, &future, false, false},
		{"disabled_expired", false, &past, true, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			u := &User{Active: c.active, ExpiresAt: c.expiresAt}
			if got := u.IsExpired(now); got != c.expired {
				t.Errorf("IsExpired = %v, want %v", got, c.expired)
			}
			if got := u.EffectiveActive(now); got != c.effective {
				t.Errorf("EffectiveActive = %v, want %v", got, c.effective)
			}
		})
	}
}
