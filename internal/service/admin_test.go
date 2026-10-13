package service

import (
	"errors"
	"testing"

	"github.com/imrui/xray-pilot/config"
	"github.com/imrui/xray-pilot/internal/dto"
	"github.com/imrui/xray-pilot/internal/entity"
)

func seedAdmins(t *testing.T, admins ...config.AdminUser) *AdminService {
	t.Helper()
	config.Global.Admins = admins
	if err := config.HashAdminPasswords(); err != nil {
		t.Fatalf("hash: %v", err)
	}
	svc := NewAdminService()
	if err := svc.SeedFromConfig(); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return svc
}

// TestAdminSeedFromConfig 验证首次种子：第一个为 super_admin，其余 admin；表非空后再次调用不重复写入
func TestAdminSeedFromConfig(t *testing.T) {
	setupServiceTestDB(t)
	svc := seedAdmins(t,
		config.AdminUser{Username: "root", Password: "rootpass"},
		config.AdminUser{Username: "ops", Password: "opspass"},
	)

	list, err := svc.List()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 || list[0].Role != entity.RoleSuperAdmin || list[1].Role != entity.RoleAdmin {
		t.Fatalf("wrong seeded role: %+v", list)
	}

	// 表非空：config 里换成别的账号也不再种入
	config.Global.Admins = []config.AdminUser{{Username: "intruder", PasswordHash: "x"}}
	if err := svc.SeedFromConfig(); err != nil {
		t.Fatalf("second seed: %v", err)
	}
	list, _ = svc.List()
	if len(list) != 2 {
		t.Fatalf("should not seed again when the table is not empty, got %d", len(list))
	}

	// 种子密码可登录
	if _, err := NewAuthService().Login(&dto.LoginRequest{Username: "root", Password: "rootpass"}); err != nil {
		t.Fatalf("seeded account failed to sign in: %v", err)
	}
}

// TestAdminLastSuperAdminGuard 验证最后一个超级管理员不能被删除 / 降级 / 禁用
func TestAdminLastSuperAdminGuard(t *testing.T) {
	setupServiceTestDB(t)
	svc := seedAdmins(t, config.AdminUser{Username: "root", Password: "rootpass"})
	list, _ := svc.List()
	rootID := list[0].ID

	other, err := svc.Create(&dto.CreateAdminRequest{Username: "ops", Password: "opspass"}, "admin:root")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	role := entity.RoleAdmin
	if _, err := svc.Update(rootID, &dto.UpdateAdminRequest{Role: &role}, other.ID, "admin:ops"); !errors.Is(err, ErrLastSuperAdmin) {
		t.Errorf("demoting the last super admin should be rejected, got %v", err)
	}
	inactive := false
	if _, err := svc.Update(rootID, &dto.UpdateAdminRequest{Active: &inactive}, other.ID, "admin:ops"); !errors.Is(err, ErrLastSuperAdmin) {
		t.Errorf("disabling the last super admin should be rejected, got %v", err)
	}
	if err := svc.Delete(rootID, other.ID, "admin:ops"); !errors.Is(err, ErrLastSuperAdmin) {
		t.Errorf("deleting the last super admin should be rejected, got %v", err)
	}
	if err := svc.Delete(rootID, rootID, "admin:root"); err == nil {
		t.Error("deleting yourself should be rejected")
	}
	if _, err := svc.Update(rootID, &dto.UpdateAdminRequest{Role: &role}, rootID, "admin:root"); err == nil || errors.Is(err, ErrLastSuperAdmin) {
		t.Errorf("changing your own role should be rejected as cannot-change-yourself, not by the last-super-admin guard, got %v", err)
	}
	if _, err := svc.Update(rootID, &dto.UpdateAdminRequest{Active: &inactive}, rootID, "admin:root"); err == nil {
		t.Error("disabling yourself should be rejected")
	}

	// 提升 ops 为 super_admin 后，root 即可降级
	superRole := entity.RoleSuperAdmin
	if _, err := svc.Update(other.ID, &dto.UpdateAdminRequest{Role: &superRole}, rootID, "admin:root"); err != nil {
		t.Fatalf("promoting ops: %v", err)
	}
	if _, err := svc.Update(rootID, &dto.UpdateAdminRequest{Role: &role}, other.ID, "admin:ops"); err != nil {
		t.Errorf("demoting should succeed once a second super admin exists, got %v", err)
	}
}

// TestAdminPasswordFlows 验证改自己密码需旧密码、重置密码不需旧密码、禁用账号不能登录
func TestAdminPasswordFlows(t *testing.T) {
	setupServiceTestDB(t)
	svc := seedAdmins(t, config.AdminUser{Username: "root", Password: "rootpass"})
	list, _ := svc.List()
	rootID := list[0].ID
	auth := NewAuthService()

	if err := svc.ChangeOwnPassword(rootID, &dto.ChangePasswordRequest{OldPassword: "wrong", NewPassword: "newpass1"}, "admin:root"); err == nil {
		t.Error("a wrong current password should be rejected")
	}
	if err := svc.ChangeOwnPassword(rootID, &dto.ChangePasswordRequest{OldPassword: "rootpass", NewPassword: "short"}, "admin:root"); err == nil {
		t.Error("a too-short password should be rejected")
	}
	if err := svc.ChangeOwnPassword(rootID, &dto.ChangePasswordRequest{OldPassword: "rootpass", NewPassword: "newpass1"}, "admin:root"); err != nil {
		t.Fatalf("change password: %v", err)
	}
	if _, err := auth.Login(&dto.LoginRequest{Username: "root", Password: "newpass1"}); err != nil {
		t.Fatalf("sign-in with the new password failed: %v", err)
	}

	ops, err := svc.Create(&dto.CreateAdminRequest{Username: "ops", Password: "opspass"}, "admin:root")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := svc.SetPassword(rootID, "resetpw1", rootID, "admin:root"); err == nil {
		t.Error("resetting your own password should be rejected; only ChangeOwnPassword is allowed")
	}
	if err := svc.SetPassword(ops.ID, "resetpw1", rootID, "admin:root"); err != nil {
		t.Fatalf("reset: %v", err)
	}
	resp, err := auth.Login(&dto.LoginRequest{Username: "ops", Password: "resetpw1"})
	if err != nil {
		t.Fatalf("sign-in after the reset failed: %v", err)
	}
	if resp.Role != entity.RoleAdmin || resp.Username != "ops" {
		t.Errorf("sign-in response has the wrong role or username: %+v", resp)
	}

	inactive := false
	if _, err := svc.Update(ops.ID, &dto.UpdateAdminRequest{Active: &inactive}, rootID, "admin:root"); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if _, err := auth.Login(&dto.LoginRequest{Username: "ops", Password: "resetpw1"}); err == nil {
		t.Error("a disabled account must not be able to sign in")
	}
}
