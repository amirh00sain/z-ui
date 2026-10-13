package service

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"

	"github.com/imrui/xray-pilot/internal/dto"
	"github.com/imrui/xray-pilot/internal/entity"
	"github.com/imrui/xray-pilot/internal/repository"
	xssh "github.com/imrui/xray-pilot/pkg/ssh"
)

const (
	// 默认 token 有效期（10 分钟）；管理员可在 ttl_seconds 字段覆盖。
	defaultInstallTTL = 10 * time.Minute
	maxInstallTTL     = 24 * time.Hour

	// 节点装机脚本默认地址；可由 env XRAY_PILOT_BOOTSTRAP_URL 覆盖（v0.4.1+ 灰度切换用）。
	defaultBootstrapURL = "https://raw.githubusercontent.com/imrui/xray-pilot/main/scripts/node-bootstrap.sh"
)

// install token 鉴权相关 sentinel 错误
var (
	ErrInstallTokenNotFound    = errors.New("install token not found")
	ErrInstallTokenUsed        = errors.New("install token has already been used")
	ErrInstallTokenExpired     = errors.New("install token has expired")
	ErrInstallTokenIPMismatch  = errors.New("install token source IP does not match the first binding")
	ErrPanelSSHKeyMissing      = errors.New("the panel has no SSH private key configured (set the path under Settings > Default SSH private key and make sure the matching .pub file exists)")
	ErrInstallNodeAlreadyExist = errors.New("a node with that name already exists - pick another name and generate the token again")
	ErrReplaceNodeNotFound     = errors.New("the node to replace does not exist")
)

// nodeMeta 是 NodeInstallToken.NodeMeta 字段反序列化后的结构。
// 仅在 install 流程内部传递，未来字段叠加不会破坏接口。
type nodeMeta struct {
	Name    string `json:"name"`
	Region  string `json:"region,omitempty"`
	Owner   string `json:"owner,omitempty"`
	Remark  string `json:"remark,omitempty"`
	SSHUser string `json:"ssh_user,omitempty"`
	SSHPort int    `json:"ssh_port,omitempty"`
}

// InstallService 节点一键接入流程的业务编排
type InstallService struct {
	tokenRepo  *repository.NodeInstallTokenRepository
	nodeRepo   *repository.NodeRepository
	logRepo    *repository.LogRepository
	settingSvc *SettingService
	panelSvc   *PanelService
}

func NewInstallService() *InstallService {
	return &InstallService{
		tokenRepo:  repository.NewNodeInstallTokenRepository(),
		nodeRepo:   repository.NewNodeRepository(),
		logRepo:    repository.NewLogRepository(),
		settingSvc: NewSettingService(),
		panelSvc:   NewPanelService(),
	}
}

// PanelPubKeyPath 返回 panel 公钥的绝对路径
// 约定：公钥 = 私钥路径 + ".pub"（ed25519 / rsa 默认形态）
//
// 私钥路径与诊断服务、同步服务统一从 SettingService 读取，
// 与系统设置页面 > 默认 SSH 私钥 的可编辑值保持一致；config.yaml
// 的 ssh.default_key_path 仅作为首次启动种子（SeedFromConfig），
// 之后以 DB 值为权威。
func (s *InstallService) PanelPubKeyPath() string {
	priv := strings.TrimSpace(s.settingSvc.Get(KeySSHDefaultKeyPath))
	if priv == "" {
		return ""
	}
	return priv + ".pub"
}

// ReadPanelPubKey 读取 panel 公钥内容
// 失败时返回 ErrPanelSSHKeyMissing，便于上层统一返回中文提示
func (s *InstallService) ReadPanelPubKey() (string, error) {
	path := s.PanelPubKeyPath()
	if path == "" {
		return "", ErrPanelSSHKeyMissing
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", ErrPanelSSHKeyMissing
	}
	content := strings.TrimSpace(string(data))
	if content == "" {
		return "", ErrPanelSSHKeyMissing
	}
	return content, nil
}

// CreateToken 生成一次性 token，并把 node_meta 持久化进 JSON 字段。
// 在生成前做关键前置校验：
//   - panel SSH 公钥可读
//   - 新建模式：同名节点不存在（避免脚本注册时撞名）
//   - 更换模式（ReplaceNodeID 非空）：目标节点存在，元数据从现有节点带出
func (s *InstallService) CreateToken(req *dto.CreateInstallTokenRequest, adminUsername string) (*dto.InstallTokenResponse, error) {
	if _, err := s.ReadPanelPubKey(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.PanelURL) == "" {
		return nil, errors.New("panel_url cannot be empty")
	}

	var meta nodeMeta
	if req.ReplaceNodeID != nil {
		// 更换服务器模式：名称等元数据沿用现有节点，SSH 参数允许请求覆盖（新机可能不同）
		node, err := s.nodeRepo.FindByID(*req.ReplaceNodeID)
		if err != nil {
			return nil, ErrReplaceNodeNotFound
		}
		meta = nodeMeta{
			Name:    node.Name,
			Region:  node.Region,
			Owner:   node.Owner,
			Remark:  node.Remark,
			SSHUser: node.SSHUser,
			SSHPort: node.SSHPort,
		}
		if req.SSHUser != "" {
			meta.SSHUser = req.SSHUser
		}
		if req.SSHPort != 0 {
			meta.SSHPort = req.SSHPort
		}
	} else {
		if strings.TrimSpace(req.Name) == "" {
			return nil, errors.New("Node name cannot be empty")
		}
		if existing, err := s.nodeRepo.FindByName(req.Name); err == nil && existing != nil {
			return nil, ErrInstallNodeAlreadyExist
		}
		meta = nodeMeta{
			Name:    req.Name,
			Region:  req.Region,
			Owner:   req.Owner,
			Remark:  req.Remark,
			SSHUser: req.SSHUser,
			SSHPort: req.SSHPort,
		}
	}
	if meta.SSHUser == "" {
		meta.SSHUser = "root"
	}
	if meta.SSHPort == 0 {
		meta.SSHPort = 22
	}

	ttl := time.Duration(req.TTLSeconds) * time.Second
	if ttl <= 0 {
		ttl = defaultInstallTTL
	}
	if ttl > maxInstallTTL {
		ttl = maxInstallTTL
	}
	metaBytes, err := json.Marshal(&meta)
	if err != nil {
		return nil, fmt.Errorf("failed to serialize the node metadata: %w", err)
	}

	tokenStr, err := randomToken(32)
	if err != nil {
		return nil, fmt.Errorf("failed to generate the token: %w", err)
	}

	now := time.Now()
	t := &entity.NodeInstallToken{
		Token:          tokenStr,
		NodeMeta:       string(metaBytes),
		CreatedAt:      now,
		ExpiresAt:      now.Add(ttl),
		CreatedByAdmin: adminUsername,
		ReplaceNodeID:  req.ReplaceNodeID,
	}
	if err := s.tokenRepo.Create(t); err != nil {
		return nil, fmt.Errorf("failed to save the token: %w", err)
	}

	curl := buildInstallCurlCommand(strings.TrimRight(req.PanelURL, "/"), tokenStr)

	action := "install_token_create"
	if req.ReplaceNodeID != nil {
		action = "replace_token_create"
	}
	s.logRepo.RecordWithActor(
		action,
		fmt.Sprintf("node=%s", meta.Name),
		fmt.Sprintf("admin:%s", adminUsername),
		true,
		fmt.Sprintf("ttl=%ds", int(ttl.Seconds())),
		0,
	)

	return s.toResponse(t, curl), nil
}

// AuthorizeToken 校验 token 是否处于可使用状态（未使用 / 未过期 / IP 匹配）。
// requireIP 非空时，token 已绑定 IP 则必须匹配。
// 在 panel-pubkey 端点首次调用时 requireIP 可传脚本来源 IP（绑定也由本方法触发）。
func (s *InstallService) AuthorizeToken(tokenStr, requireIP string) (*entity.NodeInstallToken, error) {
	t, err := s.tokenRepo.FindByToken(strings.TrimSpace(tokenStr))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInstallTokenNotFound
		}
		return nil, err
	}
	if t.IsUsed() {
		return nil, ErrInstallTokenUsed
	}
	if t.IsExpired(time.Now()) {
		return nil, ErrInstallTokenExpired
	}
	if requireIP != "" && t.UsedByIP != "" && t.UsedByIP != requireIP {
		return nil, ErrInstallTokenIPMismatch
	}
	return t, nil
}

// BindTokenIP 把首次访问 panel-pubkey 的脚本源 IP 锁定到 token
// 已绑定时不覆盖；要校验匹配先调 AuthorizeToken。
func (s *InstallService) BindTokenIP(t *entity.NodeInstallToken, ip string) error {
	if t.UsedByIP != "" || ip == "" {
		return nil
	}
	if err := s.tokenRepo.BindIP(t.ID, ip); err != nil {
		return err
	}
	t.UsedByIP = ip
	return nil
}

// RegisterNode 装机脚本回调 + 标记 token 已使用。
// 新建模式创建 Node 记录；更换模式（token.ReplaceNodeID 非空）更新现有节点，
// 分组关联 / 协议密钥 / 端口 SNI 覆盖全部保留。
// 调用前应 AuthorizeToken 校验过 IP 匹配。
func (s *InstallService) RegisterNode(t *entity.NodeInstallToken, sourceIP string, req *dto.RegisterNodeRequest) (*dto.RegisterNodeResponse, error) {
	var meta nodeMeta
	if err := json.Unmarshal([]byte(t.NodeMeta), &meta); err != nil {
		return nil, fmt.Errorf("failed to parse the token node metadata: %w", err)
	}
	if meta.SSHPort == 0 {
		meta.SSHPort = 22
	}
	if meta.SSHUser == "" {
		meta.SSHUser = "root"
	}

	// 公网 IP 优先用脚本上报的 PublicIP，缺失则回退源 IP（兼容脚本 ipify 调用失败）
	ip := strings.TrimSpace(req.PublicIP)
	if ip == "" || ip == "unknown" {
		ip = sourceIP
	}

	now := time.Now()
	var (
		node   *entity.Node
		err    error
		action = "install_node_register"
	)
	if t.ReplaceNodeID != nil {
		node, err = s.registerReplace(t, ip, now, &meta, req)
		action = "replace_node_register"
	} else {
		node, err = s.registerCreate(t, ip, now, &meta, req)
	}
	if err != nil {
		return nil, err
	}

	short := tokenShortID(t.Token)
	s.logRepo.RecordWithActor(
		action,
		fmt.Sprintf("node=%s id=%d", node.Name, node.ID),
		fmt.Sprintf("system:install-token:%s", short),
		true,
		fmt.Sprintf("ip=%s xray=%s kernel=%s distro=%s",
			ip, req.XrayVersion, req.Kernel, req.Distro),
		0,
	)

	// 注册成功后立刻 SSH 端口连通性自检；用于一键接入对话框 success 态
	// 提示"whether the panel can SSH into the node"——若不通用户可立刻去放行防火墙。
	reach, latencyMs := TCPProbe(node.IP, node.SSHPort)
	var reachMsg string
	if !reach {
		panelIP := NewPanelService().EffectiveOutboundIP()
		if panelIP != "" {
			reachMsg = fmt.Sprintf("the panel (outbound IP %s) cannot reach the node over SSH port %d: node %s. Check the cloud security group, ufw, firewalld or iptables on the node for this IP.", panelIP, node.SSHPort, node.IP)
		} else {
			reachMsg = fmt.Sprintf("the panel cannot reach the node over SSH port %d: node %s. Make sure the node firewall allows the panel outbound IP.", node.SSHPort, node.IP)
		}
	}
	// 把探针结果写回 token（供前端轮询 GetToken 时读取）。失败不影响注册主流程。
	_ = s.tokenRepo.UpdateReachability(t.ID, reach, latencyMs, reachMsg)

	// 更换模式：新机可达时自动触发一次同步，把 Reality 密钥等配置推上去尽快恢复服务。
	// 异步执行避免阻塞装机脚本；结果反映在节点列表的同步状态里，失败可手动重试。
	if t.ReplaceNodeID != nil && reach {
		nodeID := node.ID
		go func() {
			r := NewSyncService().SyncNode(nodeID, fmt.Sprintf("system:install-token:%s", tokenShortID(t.Token)))
			if r != nil && !r.Success {
				zap.L().Warn("automatic sync after the server replacement failed - sync manually",
					zap.Uint("nodeID", nodeID),
					zap.String("error", r.Error),
				)
			}
		}()
	}

	return &dto.RegisterNodeResponse{
		NodeID:             node.ID,
		Name:               node.Name,
		Reachable:          reach,
		ReachableLatencyMs: latencyMs,
		ReachableMessage:   reachMsg,
	}, nil
}

// registerCreate 新建模式：创建 Node 记录 + 标记 token 已使用
func (s *InstallService) registerCreate(t *entity.NodeInstallToken, ip string, now time.Time, meta *nodeMeta, req *dto.RegisterNodeRequest) (*entity.Node, error) {
	node := &entity.Node{
		Name:           meta.Name,
		Region:         meta.Region,
		Owner:          meta.Owner,
		Remark:         meta.Remark,
		IP:             ip,
		SSHUser:        meta.SSHUser,
		SSHPort:        meta.SSHPort,
		Active:         true,
		SyncStatus:     entity.SyncStatusPending,
		ConnectionMode: "ssh",
		RegisteredAt:   &now,
		XrayVersion:    strings.TrimSpace(req.XrayVersion),
	}

	if err := s.nodeRepo.Create(node); err != nil {
		return nil, fmt.Errorf("failed to create node: %w", err)
	}

	if err := s.tokenRepo.MarkUsed(t.ID, node.ID, now); err != nil {
		// 并发场景下别的并行 register 抢先了；删除刚创建的节点防止脏数据
		_ = s.nodeRepo.Delete(node.ID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInstallTokenUsed
		}
		return nil, err
	}
	return node, nil
}

// registerReplace 更换模式：更新现有节点的 IP/SSH/版本信息，不新建记录。
// Node ID 不变 → 分组关联、NodeProfileKey（Reality 私钥等）、端口/SNI 覆盖原样保留。
func (s *InstallService) registerReplace(t *entity.NodeInstallToken, ip string, now time.Time, meta *nodeMeta, req *dto.RegisterNodeRequest) (*entity.Node, error) {
	node, err := s.nodeRepo.FindByID(*t.ReplaceNodeID)
	if err != nil {
		return nil, ErrReplaceNodeNotFound
	}

	// 先占用 token（并发防重复注册），再更新节点
	if err := s.tokenRepo.MarkUsed(t.ID, node.ID, now); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInstallTokenUsed
		}
		return nil, err
	}

	// 清理旧机 known_hosts 条目（SSH 按 IP 连接；同 IP 换机 host key 也会变，
	// 新机走 TOFU 重新记录，不清理会导致同步时 host key 校验失败）
	if node.IP != "" {
		knownHostsPath := s.settingSvc.Get(KeySSHKnownHostsPath)
		if err := xssh.RemoveKnownHost(knownHostsPath, node.IP); err != nil {
			zap.L().Warn("failed to clean up old known_hosts entries",
				zap.String("addr", node.IP),
				zap.Error(err),
			)
		}
	}

	node.IP = ip
	node.SSHUser = meta.SSHUser
	node.SSHPort = meta.SSHPort
	node.XrayVersion = strings.TrimSpace(req.XrayVersion)
	node.XrayActive = false
	node.SyncStatus = entity.SyncStatusPending
	node.ConfigHash = ""
	node.RegisteredAt = &now

	if err := s.nodeRepo.Update(node); err != nil {
		return nil, fmt.Errorf("failed to update node: %w", err)
	}
	return node, nil
}

// ListActive 列出活跃 token；不带 curl 命令（避免反向暴露）
func (s *InstallService) ListActive() ([]dto.InstallTokenResponse, error) {
	tokens, err := s.tokenRepo.ListActive(time.Now())
	if err != nil {
		return nil, err
	}
	out := make([]dto.InstallTokenResponse, 0, len(tokens))
	for i := range tokens {
		out = append(out, *s.toResponse(&tokens[i], ""))
	}
	return out, nil
}

// FindByToken 单点查询（前端轮询用）；按 token 字符串而非 ID。
// 返回未使用 / 已使用 / 过期 三种状态都需要管理员可见，因此不做状态过滤。
func (s *InstallService) FindByToken(tokenStr string) (*dto.InstallTokenResponse, error) {
	t, err := s.tokenRepo.FindByToken(tokenStr)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInstallTokenNotFound
		}
		return nil, err
	}
	return s.toResponse(t, ""), nil
}

// Delete 管理员主动撤销
func (s *InstallService) Delete(id uint, adminUsername string) error {
	if err := s.tokenRepo.Delete(id); err != nil {
		return err
	}
	s.logRepo.RecordWithActor(
		"install_token_delete",
		fmt.Sprintf("token_id=%d", id),
		fmt.Sprintf("admin:%s", adminUsername),
		true,
		"",
		0,
	)
	return nil
}

// CleanupExpired 后台调度器调用：清理已过期且未使用的 token
func (s *InstallService) CleanupExpired() (int64, error) {
	return s.tokenRepo.DeleteExpired(time.Now())
}

func (s *InstallService) toResponse(t *entity.NodeInstallToken, curl string) *dto.InstallTokenResponse {
	resp := &dto.InstallTokenResponse{
		ID:            t.ID,
		Token:         t.Token,
		ExpiresAt:     t.ExpiresAt,
		Used:          t.IsUsed(),
		UsedByIP:      t.UsedByIP,
		ReplaceNodeID: t.ReplaceNodeID,
	}
	if t.NodeID != nil {
		resp.NodeID = t.NodeID
	}
	var meta nodeMeta
	if err := json.Unmarshal([]byte(t.NodeMeta), &meta); err == nil {
		resp.NodeName = meta.Name
	}
	if curl != "" {
		resp.CurlCommand = curl
	}
	// 面板出网 IP 总是带上，给前端 waiting 态展示防火墙提醒文案
	resp.PanelOutboundIP = s.panelSvc.EffectiveOutboundIP()
	// 探针结果（注册时写入；未注册的 token 为 nil）
	if t.Reachable != nil {
		v := *t.Reachable
		resp.Reachable = &v
		resp.ReachableLatencyMs = t.ReachableLatencyMs
		resp.ReachableMessage = t.ReachableMessage
	}
	return resp
}

// randomToken 生成 length 字节的随机 token（hex 编码）
func randomToken(length int) (string, error) {
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// tokenShortID 取 token 前 8 位作为审计日志中的简短标识
func tokenShortID(token string) string {
	if len(token) <= 8 {
		return token
	}
	return token[:8]
}

func buildInstallCurlCommand(panelURL, token string) string {
	bootstrapURL := os.Getenv("XRAY_PILOT_BOOTSTRAP_URL")
	if bootstrapURL == "" {
		bootstrapURL = defaultBootstrapURL
	}
	// 不再用 sudo 透传环境变量：
	//   1. 部分发行版 sudo 默认 env_reset，PANEL_URL / INSTALL_TOKEN 会被丢
	//   2. 用户未在 sudoers 时 sudo 直接报错，体验差
	// 改为前端文案明确提示"run as root (regular users should switch with sudo su - first)"。
	return fmt.Sprintf(
		"curl -fsSL %s | PANEL_URL=%s INSTALL_TOKEN=%s bash",
		bootstrapURL, panelURL, token,
	)
}
