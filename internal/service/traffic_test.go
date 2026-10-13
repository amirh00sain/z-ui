package service

import (
	"testing"
	"time"
)

func TestRetentionCutoff(t *testing.T) {
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	if _, ok := retentionCutoff(0, now); ok {
		t.Error("days=0 should mean no cleanup")
	}
	if _, ok := retentionCutoff(-1, now); ok {
		t.Error("a negative value should mean no cleanup")
	}
	cutoff, ok := retentionCutoff(90, now)
	if !ok {
		t.Fatal("days=90 should clean up")
	}
	if want := now.AddDate(0, 0, -90); !cutoff.Equal(want) {
		t.Errorf("cutoff = %v, want %v", cutoff, want)
	}
}
