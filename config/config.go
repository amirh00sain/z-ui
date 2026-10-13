package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"github.com/spf13/viper"
)

type Config struct {
	Server       ServerConfig       `mapstructure:"server"`
	Database     DatabaseConfig     `mapstructure:"database"`
	JWT          JWTConfig          `mapstructure:"jwt"`
	Crypto       CryptoConfig       `mapstructure:"crypto"`
	Scheduler    SchedulerConfig    `mapstructure:"scheduler"`
	Admins       []AdminUser        `mapstructure:"admins"`
	SSH          SSHConfig          `mapstructure:"ssh"`
	Subscription SubscriptionConfig `mapstructure:"subscription"`
}

type ServerConfig struct {
	Port int    `mapstructure:"port"`
	Mode string `mapstructure:"mode"`
}

type DatabaseConfig struct {
	Driver string `mapstructure:"driver"`
	DSN    string `mapstructure:"dsn"`
}

type JWTConfig struct {
	Secret string `mapstructure:"secret"`
	Expire int    `mapstructure:"expire"` // hours
}

type CryptoConfig struct {
	MasterKey string `mapstructure:"master_key"`
}

// SchedulerConfig 定时任务配置
type SchedulerConfig struct {
	// DriftCheckInterval 漂移检测间隔（秒），0 表示禁用
	DriftCheckInterval int `mapstructure:"drift_check_interval"`
	// HealthCheckInterval 健康检测间隔（秒），0 表示禁用
	HealthCheckInterval int `mapstructure:"health_check_interval"`
}

// AdminUser 管理员账号种子（config.yaml）。
// v0.5.0 起管理员入库（admin_users 表），此处仅在表为空时作首次种子；表非空后本段被忽略。
type AdminUser struct {
	Username     string `mapstructure:"username"`
	Password     string `mapstructure:"password"`      // 明文密码（启动时自动 bcrypt hash）
	PasswordHash string `mapstructure:"password_hash"` // bcrypt 哈希（优先使用）
}

// SSHConfig SSH 默认参数
type SSHConfig struct {
	DefaultPort    int    `mapstructure:"default_port"`
	DefaultUser    string `mapstructure:"default_user"`
	DefaultKeyPath string `mapstructure:"default_key_path"`
	KnownHostsPath string `mapstructure:"known_hosts_path"`
}

// SubscriptionConfig 订阅相关配置
type SubscriptionConfig struct {
	BaseURL      string `mapstructure:"base_url"`       // 订阅链接前缀（空则动态获取）
	RemarkFormat string `mapstructure:"remark_format"`   // 备注格式，如 "{region}-{name}"
}

var Global Config

// Load 加载配置，支持环境变量覆盖
func Load() error {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")

	// 设置默认值
	// The panel is served on 8080 unless XRAY_PILOT_SERVER_PORT overrides it.
	viper.SetDefault("server.port", 8080)
	viper.SetDefault("server.mode", "debug")
	viper.SetDefault("database.driver", "sqlite")
	viper.SetDefault("database.dsn", "xray-pilot.db")
	viper.SetDefault("jwt.expire", 24)
	// Registering a default for every key we expect to override from the environment:
	// viper only exposes AutomaticEnv values for keys it already knows about.
	viper.SetDefault("jwt.secret", "")
	viper.SetDefault("scheduler.drift_check_interval", 300)  // 5 minutes
	viper.SetDefault("scheduler.health_check_interval", 120) // 2 minutes
	viper.SetDefault("ssh.default_port", 22)
	viper.SetDefault("ssh.default_user", "root")
	viper.SetDefault("ssh.default_key_path", "/etc/xray-pilot/ssh/id_ed25519")
	viper.SetDefault("ssh.known_hosts_path", "/var/lib/xray-pilot/known_hosts")
	viper.SetDefault("subscription.base_url", "")
	viper.SetDefault("subscription.remark_format", "{region}-{name}")

	// 支持环境变量覆盖，例如 XRAY_PILOT_SERVER_PORT
	viper.SetEnvPrefix("XRAY_PILOT")
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return fmt.Errorf("failed to read config file: %w", err)
		}
	}

	if err := viper.Unmarshal(&Global); err != nil {
		return fmt.Errorf("failed to parse config: %w", err)
	}

	// MasterKey 三级优先级
	// 1. 环境变量 XRAY_PILOT_MASTER_KEY
	// 2. config.yaml 中 crypto.master_key
	// 3. 首次启动自动生成并打印提示
	if envKey := os.Getenv("XRAY_PILOT_MASTER_KEY"); envKey != "" {
		Global.Crypto.MasterKey = envKey
	}
	if Global.Crypto.MasterKey == "" {
		key, err := generateMasterKey()
		if err != nil {
			return fmt.Errorf("failed to generate MasterKey: %w", err)
		}
		Global.Crypto.MasterKey = key
		fmt.Printf(`
================================================================
  [xray-pilot] First start: a MasterKey has been generated.
  Store it in config.yaml under crypto.master_key, or set the
  XRAY_PILOT_MASTER_KEY environment variable.

  %s
================================================================
`, key)
	}

	// 若未配置管理员，自动添加默认管理员种子（首次启动入库后请在面板内修改密码）
	if len(Global.Admins) == 0 {
		fmt.Println("[xray-pilot] warning: no admins configured; the default admin/admin account is seeded on first boot - change the password right after signing in")
		Global.Admins = []AdminUser{{Username: "admin", Password: "admin"}}
	}

	// An empty JWT secret would let anyone mint a valid token, so fall back to a
	// random one and say so. Sessions then die on restart — set XRAY_PILOT_JWT_SECRET
	// (or jwt.secret in config.yaml) to keep them across deployments.
	if Global.JWT.Secret == "" {
		secret, err := generateMasterKey()
		if err != nil {
			return fmt.Errorf("failed to generate JWT secret: %w", err)
		}
		Global.JWT.Secret = secret
		fmt.Println("[xray-pilot] warning: jwt.secret is not set - a random secret was generated for this run, so every session ends on restart. Set XRAY_PILOT_JWT_SECRET to keep sessions across restarts.")
	}

	// 对明文密码进行 bcrypt hash（内存操作，不写回文件）
	if err := HashAdminPasswords(); err != nil {
		return fmt.Errorf("failed to hash admin passwords: %w", err)
	}

	return nil
}

// HashAdminPasswords 将 config.yaml 中明文密码在内存中哈希
func HashAdminPasswords() error {
	for i, admin := range Global.Admins {
		if admin.Password != "" {
			hash, err := bcrypt.GenerateFromPassword([]byte(admin.Password), bcrypt.DefaultCost)
			if err != nil {
				return fmt.Errorf("admin %s: %w", admin.Username, err)
			}
			Global.Admins[i].PasswordHash = string(hash)
			Global.Admins[i].Password = "" // 清除明文
		}
	}
	return nil
}

func generateMasterKey() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
