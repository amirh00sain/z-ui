package service

import (
	"reflect"
	"sort"
	"testing"
)

func TestNodeSetIf(t *testing.T) {
	ids := []uint{1, 2, 3}
	if got := nodeSetIf(true, ids); !reflect.DeepEqual(got, ids) {
		t.Errorf("active=true should be returned unchanged, got %v", got)
	}
	if got := nodeSetIf(false, ids); got != nil {
		t.Errorf("active=false should return nil (an inactive user is on no node), got %v", got)
	}
}

func TestNodeIDsDiff(t *testing.T) {
	cases := []struct {
		name string
		a, b []uint
		want []uint
	}{
		{"added to a new node", []uint{1, 2, 3}, []uint{1}, []uint{2, 3}},
		{"no change", []uint{1, 2}, []uint{1, 2}, nil},
		{"removed from all", nil, []uint{1, 2}, nil},
		{"added from an empty set", []uint{1, 2}, nil, []uint{1, 2}},
		{"partial overlap", []uint{1, 2, 3}, []uint{2, 4}, []uint{1, 3}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := nodeIDsDiff(c.a, c.b)
			sort.Slice(got, func(i, j int) bool { return got[i] < got[j] })
			if len(got) == 0 && len(c.want) == 0 {
				return
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("nodeIDsDiff(%v,%v) = %v, want %v", c.a, c.b, got, c.want)
			}
		})
	}
}

// TestUpdateDiffScenarios 验证「旧/新期望节点集」差集对账在典型用户更新场景下算出正确的增删集。
// 模拟 applyUpdateLive 的核心计算（不触 DB/gRPC）。
func TestUpdateDiffScenarios(t *testing.T) {
	diff := func(oldActive bool, oldNodes []uint, newActive bool, newNodes []uint) (add, remove []uint) {
		desiredOld := nodeSetIf(oldActive, oldNodes)
		desiredNew := nodeSetIf(newActive, newNodes)
		return nodeIDsDiff(desiredNew, desiredOld), nodeIDsDiff(desiredOld, desiredNew)
	}
	sortU := func(s []uint) []uint { sort.Slice(s, func(i, j int) bool { return s[i] < s[j] }); return s }
	eq := func(a, b []uint) bool {
		if len(a) == 0 && len(b) == 0 {
			return true
		}
		return reflect.DeepEqual(sortU(a), sortU(b))
	}

	t.Run("added to a new group_nodes grow", func(t *testing.T) {
		add, rm := diff(true, []uint{1}, true, []uint{1, 2})
		if !eq(add, []uint{2}) || !eq(rm, nil) {
			t.Errorf("add=%v rm=%v, want add=[2] rm=[]", add, rm)
		}
	})
	t.Run("removed from a group_nodes shrink", func(t *testing.T) {
		add, rm := diff(true, []uint{1, 2, 3}, true, []uint{1})
		if !eq(add, nil) || !eq(rm, []uint{2, 3}) {
			t.Errorf("add=%v rm=%v, want add=[] rm=[2 3]", add, rm)
		}
	})
	t.Run("disabled_removed from every node", func(t *testing.T) {
		add, rm := diff(true, []uint{1, 2}, false, []uint{1, 2})
		if !eq(add, nil) || !eq(rm, []uint{1, 2}) {
			t.Errorf("add=%v rm=%v, want add=[] rm=[1 2]", add, rm)
		}
	})
	t.Run("enabled_added to every node", func(t *testing.T) {
		add, rm := diff(false, []uint{1, 2}, true, []uint{1, 2})
		if !eq(add, []uint{1, 2}) || !eq(rm, nil) {
			t.Errorf("add=%v rm=%v, want add=[1 2] rm=[]", add, rm)
		}
	})
	t.Run("expiry only_still active_no changes", func(t *testing.T) {
		add, rm := diff(true, []uint{1, 2}, true, []uint{1, 2})
		if !eq(add, nil) || !eq(rm, nil) {
			t.Errorf("add=%v rm=%v, want empty (a non-node field change must not trigger live-apply)", add, rm)
		}
	})
	// 以下两例的 active 入参代表 EffectiveActive（启用 且 未过期），
	// 覆盖 v0.4.9 过期/续期场景：期望集必须随过期状态变化，否则续期后用户不会被加回运行时。
	t.Run("expired user renewed_added back to every node", func(t *testing.T) {
		add, rm := diff(false, []uint{1, 2}, true, []uint{1, 2})
		if !eq(add, []uint{1, 2}) || !eq(rm, nil) {
			t.Errorf("add=%v rm=%v, want add=[1 2] rm=[]", add, rm)
		}
	})
	t.Run("active user became expired_removed from every node", func(t *testing.T) {
		add, rm := diff(true, []uint{1, 2}, false, []uint{1, 2})
		if !eq(add, nil) || !eq(rm, []uint{1, 2}) {
			t.Errorf("add=%v rm=%v, want add=[] rm=[1 2]", add, rm)
		}
	})
}
