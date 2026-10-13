package service

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/imrui/xray-pilot/config"
	"github.com/imrui/xray-pilot/internal/entity"
	"github.com/imrui/xray-pilot/internal/repository"
)

type DiagnosticStatus string

const (
	DiagnosticOK      DiagnosticStatus = "ok"
	DiagnosticWarning DiagnosticStatus = "warning"
	DiagnosticError   DiagnosticStatus = "error"
)

type DiagnosticItem struct {
	Key        string           `json:"key"`
	Label      string           `json:"label"`
	Status     DiagnosticStatus `json:"status"`
	Detail     string           `json:"detail"`
	Suggestion string           `json:"suggestion,omitempty"`
	Value      string           `json:"value,omitempty"`
}

type DiagnosticsResult struct {
	Summary struct {
		OK      int `json:"ok"`
		Warning int `json:"warning"`
		Error   int `json:"error"`
	} `json:"summary"`
	Items []DiagnosticItem `json:"items"`
}

type DiagnosticsService struct {
	settings *SettingService
}

func NewDiagnosticsService() *DiagnosticsService {
	return &DiagnosticsService{settings: NewSettingService()}
}

func (s *DiagnosticsService) Run() DiagnosticsResult {
	items := []DiagnosticItem{
		s.checkDatabase(),
		s.checkSubscriptionBaseURL(),
		s.checkSSHDefaultKeyPath(),
		s.checkKnownHostsPath(),
		s.checkWorkingConfig(),
		s.checkDuplicateSubscribeNodes(),
	}

	var result DiagnosticsResult
	result.Items = items
	for _, item := range items {
		switch item.Status {
		case DiagnosticOK:
			result.Summary.OK++
		case DiagnosticWarning:
			result.Summary.Warning++
		case DiagnosticError:
			result.Summary.Error++
		}
	}
	return result
}

func (s *DiagnosticsService) checkDatabase() DiagnosticItem {
	cfg := config.Global.Database
	item := DiagnosticItem{
		Key:    "database",
		Label:  "Database path",
		Value:  cfg.DSN,
		Status: DiagnosticOK,
	}

	if cfg.Driver != "sqlite" {
		item.Detail = "An external database driver is in use, so no local file write check was run."
		return item
	}

	targetDir := filepath.Dir(cfg.DSN)
	if targetDir == "." || targetDir == "" {
		targetDir = "."
	}
	if err := ensureDirWritable(targetDir, ".xray-pilot-db-check"); err != nil {
		item.Status = DiagnosticError
		item.Detail = "The SQLite data directory is currently not writable."
		item.Suggestion = err.Error()
		return item
	}

	item.Detail = "The SQLite data directory is writable."
	return item
}

func (s *DiagnosticsService) checkSubscriptionBaseURL() DiagnosticItem {
	baseURL := strings.TrimSpace(s.settings.Get(KeySubscriptionBaseURL))
	item := DiagnosticItem{
		Key:    "subscription_base_url",
		Label:  "Subscription base URL",
		Value:  baseURL,
		Status: DiagnosticOK,
	}

	if baseURL == "" {
		item.Status = DiagnosticWarning
		item.Detail = "The subscription URL is currently derived from the request headers."
		item.Suggestion = "If the service runs behind Nginx, a CDN or an HTTPS reverse proxy, set subscription.base_url explicitly."
		return item
	}

	if strings.HasPrefix(baseURL, "https://") {
		item.Detail = "The subscription base URL is explicitly configured and uses HTTPS."
		return item
	}

	if strings.HasPrefix(baseURL, "http://") {
		item.Status = DiagnosticWarning
		item.Detail = "The subscription base URL is configured but does not use HTTPS."
		item.Suggestion = "If users reach the panel over HTTPS, change subscription.base_url to an https:// domain."
		return item
	}

	item.Status = DiagnosticWarning
	item.Detail = "The subscription base URL is configured but does not look like a standard URL."
	item.Suggestion = "Example: https://example.com"
	return item
}

func (s *DiagnosticsService) checkSSHDefaultKeyPath() DiagnosticItem {
	keyPath := strings.TrimSpace(s.settings.Get(KeySSHDefaultKeyPath))
	item := DiagnosticItem{
		Key:    "ssh_default_key_path",
		Label:  "Default SSH private key",
		Value:  keyPath,
		Status: DiagnosticOK,
	}

	if keyPath == "" {
		item.Status = DiagnosticWarning
		item.Detail = "No default SSH private key path is configured."
		item.Suggestion = "For a systemd deployment use /etc/xray-pilot/ssh/id_ed25519 and save it in the system settings."
		return item
	}

	info, err := os.Stat(keyPath)
	if err != nil {
		item.Status = DiagnosticError
		item.Detail = "The default SSH private key path does not exist or cannot be accessed."
		item.Suggestion = "Confirm the file exists and that the service user can read it."
		return item
	}
	if info.IsDir() {
		item.Status = DiagnosticError
		item.Detail = "The default SSH private key path points at a directory, not a file."
		item.Suggestion = "Enter the actual key file path, for example /etc/xray-pilot/ssh/id_ed25519."
		return item
	}
	f, err := os.Open(keyPath)
	if err != nil {
		item.Status = DiagnosticError
		item.Detail = "The default SSH private key exists but this process cannot read it."
		item.Suggestion = "Check the owner, group and permissions so the service user can read it."
		return item
	}
	_ = f.Close()

	// 同步检查 .pub 公钥：节点一键接入需要把公钥写入新节点 authorized_keys。
	// 公钥缺失不影响普通 SSH 同步，仅作 warning 提示，避免误判为致命错误。
	pubPath := keyPath + ".pub"
	if _, pubErr := os.Stat(pubPath); pubErr != nil {
		item.Status = DiagnosticWarning
		item.Detail = "The default SSH private key exists but its .pub file is missing, so one-click node provisioning will not work."
		item.Suggestion = "Generate the matching public key: ssh-keygen -y -f " + keyPath + " > " + pubPath
		return item
	}

	item.Detail = "The default SSH private key and its readable .pub file are present - one-click provisioning is ready."
	return item
}

func (s *DiagnosticsService) checkKnownHostsPath() DiagnosticItem {
	path := strings.TrimSpace(s.settings.Get(KeySSHKnownHostsPath))
	item := DiagnosticItem{
		Key:    "ssh_known_hosts_path",
		Label:  "known_hosts path",
		Value:  path,
		Status: DiagnosticOK,
	}

	if path == "" {
		item.Status = DiagnosticWarning
		item.Detail = "No known_hosts path is configured; the program default is used."
		item.Suggestion = "Set it explicitly to /var/lib/xray-pilot/known_hosts."
		return item
	}

	dir := filepath.Dir(path)
	if err := ensureDirWritable(dir, ".xray-pilot-known-hosts-check"); err != nil {
		item.Status = DiagnosticError
		item.Detail = "The known_hosts directory is not writable."
		item.Suggestion = err.Error()
		return item
	}

	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		item.Status = DiagnosticError
		item.Detail = "The known_hosts file is not readable or writable."
		item.Suggestion = "Check the file and parent directory permissions so the service user can create and write it."
		return item
	}
	_ = f.Close()

	item.Detail = "The known_hosts file can be created and is readable and writable."
	return item
}

func (s *DiagnosticsService) checkWorkingConfig() DiagnosticItem {
	item := DiagnosticItem{
		Key:    "config_file",
		Label:  "Current config file",
		Value:  "config.yaml",
		Status: DiagnosticOK,
	}

	f, err := os.Open("config.yaml")
	if err != nil {
		item.Status = DiagnosticError
		item.Detail = "config.yaml in the working directory cannot be read."
		item.Suggestion = "Confirm WorkingDirectory is correct, or check the permissions on /etc/xray-pilot/config.yaml."
		return item
	}
	_ = f.Close()

	item.Detail = "This process can read config.yaml."
	return item
}

// checkDuplicateSubscribeNodes 检测订阅输出里"identical apart from the name"的节点。
//
// V2rayN / Shadowrocket 等客户端更新订阅时会按配置内容（忽略备注名）去重，
// 两个节点若连接地址、端口、密钥材料全部一致，客户端只会保留一个——表现为
// "The subscription page lists N nodes but the client only loads N-1"。典型成因：复制节点时误配了
// 相同的域名/IP，或更换服务器后旧节点未删。
func (s *DiagnosticsService) checkDuplicateSubscribeNodes() DiagnosticItem {
	item := DiagnosticItem{
		Key:    "subscribe_duplicate_nodes",
		Label:  "Duplicate subscription node check",
		Status: DiagnosticOK,
	}

	nodeRepo := repository.NewNodeRepository()
	profileRepo := repository.NewInboundProfileRepository()
	subSvc := NewSubscribeService()

	nodes, err := nodeRepo.FindAll()
	if err != nil {
		item.Status = DiagnosticWarning
		item.Detail = "Failed to query nodes, duplicate check skipped."
		item.Suggestion = err.Error()
		return item
	}

	// 同一用户在所有节点上的 UUID 相同，用固定占位用户构建 URI，
	// 去掉备注片段后逐字对比，即可等价复现客户端的去重判定。
	probe := &entity.User{UUID: "00000000-0000-0000-0000-000000000000", Username: "diagnostic"}
	seen := map[string][]string{}
	for i := range nodes {
		node := &nodes[i]
		keys, err := profileRepo.FindActiveKeysForNode(node.ID)
		if err != nil {
			continue
		}
		for _, key := range keys {
			key := key
			uri := subSvc.buildURI(probe, node, key.Profile, &key)
			if uri == "" {
				continue
			}
			if idx := strings.Index(uri, "#"); idx >= 0 {
				uri = uri[:idx]
			}
			label := node.Name
			if key.Profile != nil {
				label = fmt.Sprintf("%s(%s)", node.Name, key.Profile.Protocol)
			}
			seen[uri] = append(seen[uri], label)
		}
	}

	var dups []string
	for _, names := range seen {
		if len(names) > 1 {
			dups = append(dups, strings.Join(names, " / "))
		}
	}
	if len(dups) > 0 {
		sort.Strings(dups)
		item.Status = DiagnosticWarning
		item.Detail = "These nodes produce subscription URLs that are identical apart from the name. Clients such as V2rayN and Shadowrocket deduplicate on update, so they end up with fewer nodes than the subscription page."
		item.Suggestion = "Check whether the connection address (IP/domain), port and protocol key were accidentally set to the same values:" + strings.Join(dups, "；")
		return item
	}

	item.Detail = "No subscription nodes are identical apart from their name."
	return item
}

func ensureDirWritable(dir, probeName string) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	probePath := filepath.Join(dir, probeName)
	f, err := os.OpenFile(probePath, os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	_ = f.Close()
	_ = os.Remove(probePath)
	return nil
}
