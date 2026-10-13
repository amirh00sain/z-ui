package types

import "testing"

func TestEffectiveRealitySNI(t *testing.T) {
	cases := []struct {
		name    string
		profile *VlessRealitySettings
		key     *RealityKeyMaterial
		want    string
	}{
		{"node override wins", &VlessRealitySettings{SNI: "tpl.com"}, &RealityKeyMaterial{SNI: "node.com"}, "node.com"},
		{"empty node falls back to template", &VlessRealitySettings{SNI: "tpl.com"}, &RealityKeyMaterial{}, "tpl.com"},
		{"both empty uses default", &VlessRealitySettings{}, &RealityKeyMaterial{}, DefaultRealitySNI},
		{"nil key uses template", &VlessRealitySettings{SNI: "tpl.com"}, nil, "tpl.com"},
		{"all nil uses default", nil, nil, DefaultRealitySNI},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := EffectiveRealitySNI(c.profile, c.key); got != c.want {
				t.Fatalf("EffectiveRealitySNI = %q, want %q", got, c.want)
			}
		})
	}
}

func TestEffectiveRealityFingerprint(t *testing.T) {
	cases := []struct {
		name    string
		profile *VlessRealitySettings
		key     *RealityKeyMaterial
		want    string
	}{
		{"node override wins", &VlessRealitySettings{Fingerprint: "firefox"}, &RealityKeyMaterial{Fingerprint: "safari"}, "safari"},
		{"empty node falls back to template", &VlessRealitySettings{Fingerprint: "firefox"}, &RealityKeyMaterial{}, "firefox"},
		{"both empty uses default", &VlessRealitySettings{}, &RealityKeyMaterial{}, DefaultRealityFingerprint},
		{"all nil uses default", nil, nil, DefaultRealityFingerprint},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := EffectiveRealityFingerprint(c.profile, c.key); got != c.want {
				t.Fatalf("EffectiveRealityFingerprint = %q, want %q", got, c.want)
			}
		})
	}
}
