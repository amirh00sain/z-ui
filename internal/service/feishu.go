package service

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/imrui/xray-pilot/internal/dto"
	"github.com/imrui/xray-pilot/internal/entity"
	"github.com/imrui/xray-pilot/internal/repository"
)

type FeishuService struct {
	settingSvc *SettingService
	userRepo   *repository.UserRepository
	logRepo    *repository.LogRepository
	httpClient *http.Client
}

func NewFeishuService() *FeishuService {
	return &FeishuService{
		settingSvc: NewSettingService(),
		userRepo:   repository.NewUserRepository(),
		logRepo:    repository.NewLogRepository(),
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

func (s *FeishuService) GetStatus() *dto.FeishuStatusResponse {
	enabled := strings.EqualFold(strings.TrimSpace(s.settingSvc.Get(KeyFeishuEnabled)), "true")
	appID := strings.TrimSpace(s.settingSvc.Get(KeyFeishuAppID))
	appSecret := strings.TrimSpace(s.settingSvc.Get(KeyFeishuAppSecret))
	verificationToken := strings.TrimSpace(s.settingSvc.Get(KeyFeishuVerificationToken))
	baseURL := strings.TrimRight(strings.TrimSpace(s.settingSvc.Get(KeyFeishuBaseURL)), "/")
	botName := strings.TrimSpace(s.settingSvc.Get(KeyFeishuBotName))

	missing := make([]string, 0, 4)
	if appID == "" {
		missing = append(missing, KeyFeishuAppID)
	}
	if appSecret == "" {
		missing = append(missing, KeyFeishuAppSecret)
	}
	if verificationToken == "" {
		missing = append(missing, KeyFeishuVerificationToken)
	}
	if baseURL == "" {
		missing = append(missing, KeyFeishuBaseURL)
	}

	status := &dto.FeishuStatusResponse{
		Enabled:     enabled,
		Configured:  len(missing) == 0,
		MissingKeys: missing,
		BotName:     botName,
	}
	if baseURL != "" {
		status.WebhookURL = baseURL + "/api/feishu/events"
	}
	return status
}

func (s *FeishuService) ValidateConfig() *dto.FeishuStatusResponse {
	return s.GetStatus()
}

func (s *FeishuService) IsEnabled() bool {
	return strings.EqualFold(strings.TrimSpace(s.settingSvc.Get(KeyFeishuEnabled)), "true")
}

func (s *FeishuService) ValidateVerificationToken(token string) bool {
	expected := strings.TrimSpace(s.settingSvc.Get(KeyFeishuVerificationToken))
	return expected == "" || token == expected
}

func (s *FeishuService) DecryptEvent(encrypt string) ([]byte, error) {
	encryptKey := strings.TrimSpace(s.settingSvc.Get(KeyFeishuEncryptKey))
	if encryptKey == "" {
		return nil, fmt.Errorf("Feishu Encrypt Key is not configured")
	}

	raw, err := base64.StdEncoding.DecodeString(encrypt)
	if err != nil {
		return nil, fmt.Errorf("failed to decode the encrypted Feishu event: %w", err)
	}
	if len(raw) < aes.BlockSize || len(raw)%aes.BlockSize != 0 {
		return nil, fmt.Errorf("invalid Feishu encrypted event length")
	}

	key := sha256.Sum256([]byte(encryptKey))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, fmt.Errorf("failed to initialise Feishu event decryption: %w", err)
	}

	iv := raw[:aes.BlockSize]
	payload := make([]byte, len(raw)-aes.BlockSize)
	copy(payload, raw[aes.BlockSize:])
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(payload, payload)

	plain, err := pkcs7Unpad(payload, aes.BlockSize)
	if err != nil {
		return nil, fmt.Errorf("failed to unpad the Feishu event: %w", err)
	}
	return plain, nil
}

func pkcs7Unpad(data []byte, blockSize int) ([]byte, error) {
	if len(data) == 0 || len(data)%blockSize != 0 {
		return nil, fmt.Errorf("invalid padded data")
	}
	padding := int(data[len(data)-1])
	if padding == 0 || padding > blockSize || padding > len(data) {
		return nil, fmt.Errorf("invalid padding size")
	}
	for _, b := range data[len(data)-padding:] {
		if int(b) != padding {
			return nil, fmt.Errorf("invalid padding bytes")
		}
	}
	return data[:len(data)-padding], nil
}

func maskID(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 8 {
		return value
	}
	return value[:4] + "..." + value[len(value)-4:]
}

func maskEmail(value string) string {
	value = strings.TrimSpace(value)
	parts := strings.Split(value, "@")
	if len(parts) != 2 || len(parts[0]) <= 2 {
		return value
	}
	return parts[0][:2] + "***@" + parts[1]
}

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func (s *FeishuService) FindBoundUser(openID, unionID string) (*entity.User, error) {
	return s.userRepo.FindByFeishuIdentity(openID, unionID)
}

func (s *FeishuService) BuildHelpText() string {
	return "Supported commands: subscription, link, QR code, help. Send subscription for your subscription details, or QR code to open the subscription page."
}

// actorFeishuWebhook 飞书事件回调触发的操作日志 actor
const actorFeishuWebhook = "system:feishu-webhook"

func (s *FeishuService) RecordWebhookDebug(openID, unionID, keyword string) {
	s.logRepo.RecordWithActor("feishu_webhook", "message", actorFeishuWebhook, true, fmt.Sprintf("received a Feishu message, keyword=%s open_id=%s union_id=%s", keyword, maskID(openID), maskID(unionID)), 0)
}

func (s *FeishuService) BuildUnboundText() string {
	return "This Feishu account is not bound to a subscription user yet - contact your administrator."
}

func (s *FeishuService) BuildDisabledText() string {
	return "Feishu messaging is not enabled for this account - contact your administrator."
}

func (s *FeishuService) BuildPendingBindText() string {
	return "This Feishu account has not finished identity binding - contact your administrator to check the Feishu email configuration."
}

func (s *FeishuService) BuildSubscriptionLinks(user *entity.User) (pageURL string, subURL string) {
	base := strings.TrimRight(strings.TrimSpace(s.settingSvc.Get(KeySubscriptionBaseURL)), "/")
	if base == "" {
		base = strings.TrimRight(strings.TrimSpace(s.settingSvc.Get(KeyFeishuBaseURL)), "/")
	}
	if base == "" {
		return "", ""
	}
	pageURL = fmt.Sprintf("%s/sub/%s", base, user.Token)
	subURL = pageURL + "?sub=1"
	return pageURL, subURL
}

func (s *FeishuService) SendHelpMessage(openID string) error {
	return s.sendTextMessage(openID, s.BuildHelpText())
}

func (s *FeishuService) SendUnboundMessage(openID string) error {
	return s.sendTextMessage(openID, s.BuildUnboundText())
}

func (s *FeishuService) SendTextMessageForUser(openID, text string) error {
	return s.sendTextMessage(openID, text)
}

func (s *FeishuService) SendSubscriptionMessage(openID string, user *entity.User) error {
	return s.sendSubscriptionContent(openID, "open_id", user)
}

func (s *FeishuService) SendSubscriptionToUser(user *entity.User) error {
	receiveID, receiveType, ok := s.resolveRecipient(user)
	if !ok {
		return fmt.Errorf("user %s has no usable Feishu identity bound", user.Username)
	}
	return s.sendSubscriptionContent(receiveID, receiveType, user)
}

type FeishuUserProfile struct {
	Name            string `json:"name"`
	Email           string `json:"email"`
	EnterpriseEmail string `json:"enterprise_email"`
	OpenID          string `json:"open_id"`
	UnionID         string `json:"union_id"`
}

func (s *FeishuService) sendTextMessage(openID, text string) error {
	content, err := json.Marshal(map[string]string{"text": text})
	if err != nil {
		return err
	}
	return s.sendMessage(openID, "open_id", "text", string(content))
}

func (s *FeishuService) sendMessage(receiveID, receiveIDType, msgType, content string) error {
	token, err := s.getTenantAccessToken()
	if err != nil {
		return err
	}

	body, err := json.Marshal(map[string]string{
		"receive_id": receiveID,
		"msg_type":   msgType,
		"content":    content,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequest(
		http.MethodPost,
		"https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type="+receiveIDType,
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to call the Feishu send-message API: %w", err)
	}
	defer resp.Body.Close()

	var payload struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if decodeErr := json.NewDecoder(resp.Body).Decode(&payload); decodeErr != nil {
		return fmt.Errorf("failed to parse the Feishu response: %w", decodeErr)
	}
	if resp.StatusCode >= 300 || payload.Code != 0 {
		return fmt.Errorf("Feishu send failed: %s", payload.Msg)
	}
	return nil
}

func (s *FeishuService) sendSubscriptionContent(receiveID, receiveIDType string, user *entity.User) error {
	pageURL, subURL := s.BuildSubscriptionLinks(user)
	if pageURL == "" {
		return fmt.Errorf("subscription.base_url is not configured, so the Feishu subscription link cannot be built")
	}

	statusText := "Active"
	if !user.Active {
		statusText = "Disabled"
	}
	expireText := "No expiry"
	if user.ExpiresAt != nil {
		expireText = user.ExpiresAt.Format("2006-01-02 15:04")
	}

	cardContent := map[string]any{
		"config": map[string]any{
			"wide_screen_mode": true,
			"enable_forward":   true,
		},
		"header": map[string]any{
			"template": "green",
			"title": map[string]string{
				"tag":     "plain_text",
				"content": "Xray Pilot subscription details",
			},
		},
		"elements": []map[string]any{
			{
				"tag": "div",
				"text": map[string]string{
					"tag": "lark_md",
					"content": fmt.Sprintf(
						"**Username**: %s\n**Status**: %s\n**Expires**: %s",
						user.Username,
						statusText,
						expireText,
					),
				},
			},
			{
				"tag": "action",
				"actions": []map[string]any{
					{
						"tag":  "button",
						"type": "primary",
						"text": map[string]string{
							"tag":     "plain_text",
							"content": "Open the subscription page",
						},
						"url": pageURL,
					},
				},
			},
			{
				"tag": "div",
				"text": map[string]string{
					"tag":     "lark_md",
					"content": "**Client subscription link**\nCopy the link below to import into v2rayN, Clash and similar clients. Open the subscription page for the QR code or node details.",
				},
			},
			{
				"tag": "div",
				"text": map[string]string{
					"tag":     "plain_text",
					"content": subURL,
				},
			},
		},
	}

	content, err := json.Marshal(cardContent)
	if err != nil {
		return err
	}
	return s.sendMessage(receiveID, receiveIDType, "interactive", string(content))
}

func (s *FeishuService) resolveRecipient(user *entity.User) (receiveID string, receiveType string, ok bool) {
	if !user.FeishuEnabled {
		return "", "", false
	}
	if strings.TrimSpace(user.FeishuOpenID) != "" {
		return strings.TrimSpace(user.FeishuOpenID), "open_id", true
	}
	if strings.TrimSpace(user.FeishuChatID) != "" {
		return strings.TrimSpace(user.FeishuChatID), "chat_id", true
	}
	return "", "", false
}

type feishuEmailLookupResult struct {
	Email   string
	OpenID  string
	UnionID string
}

func (s *FeishuService) lookupUserByEmail(email string) (*feishuEmailLookupResult, error) {
	token, err := s.getTenantAccessToken()
	if err != nil {
		return nil, err
	}

	body, err := json.Marshal(map[string]any{
		"emails":           []string{strings.TrimSpace(email)},
		"include_resigned": false,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(
		http.MethodPost,
		"https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to look up a user by Feishu email: %w", err)
	}
	defer resp.Body.Close()

	var payload struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			UserList []struct {
				Email   string `json:"email"`
				OpenID  string `json:"open_id"`
				UnionID string `json:"union_id"`
			} `json:"user_list"`
		} `json:"data"`
	}
	if decodeErr := json.NewDecoder(resp.Body).Decode(&payload); decodeErr != nil {
		return nil, fmt.Errorf("failed to parse the Feishu email lookup response: %w", decodeErr)
	}
	if resp.StatusCode >= 300 || payload.Code != 0 {
		return nil, fmt.Errorf("failed to look up a user by Feishu email: %s", payload.Msg)
	}
	if len(payload.Data.UserList) == 0 {
		return nil, fmt.Errorf("no matching Feishu user found")
	}
	item := payload.Data.UserList[0]
	emailMatched := strings.TrimSpace(item.Email)
	if emailMatched == "" {
		emailMatched = strings.TrimSpace(email)
	}
	return &feishuEmailLookupResult{
		Email:   emailMatched,
		OpenID:  strings.TrimSpace(item.OpenID),
		UnionID: strings.TrimSpace(item.UnionID),
	}, nil
}

func (s *FeishuService) BindUserByEmail(userID uint, email string, actor string) (*entity.User, error) {
	if !s.IsEnabled() {
		return nil, fmt.Errorf("Feishu integration is currently disabled")
	}
	status := s.GetStatus()
	if !status.Configured {
		return nil, fmt.Errorf("Feishu configuration is incomplete: %s", strings.Join(status.MissingKeys, "、"))
	}

	user, err := s.userRepo.FindByID(userID)
	if err != nil {
		return nil, fmt.Errorf("user not found")
	}

	email = normalizeEmail(email)
	if email == "" {
		return nil, fmt.Errorf("set a Feishu email first")
	}

	s.logRepo.RecordWithActor("feishu_bind", fmt.Sprintf("user:%s(%d)", user.Username, user.ID), actor, true, "binding Feishu by email: "+maskEmail(email), 0)

	lookup, err := s.lookupUserByEmail(email)
	if err != nil {
		s.logRepo.RecordWithActor("feishu_bind", fmt.Sprintf("user:%s(%d)", user.Username, user.ID), actor, false, err.Error(), 0)
		return nil, err
	}

	now := time.Now()
	previousEmail := normalizeEmail(user.FeishuEmail)
	normalizedEmail := normalizeEmail(lookup.Email)
	user.FeishuEnabled = true
	user.FeishuEmail = normalizedEmail
	if lookup.OpenID != "" {
		profile, err := s.GetUserProfile(lookup.OpenID, actor)
		if err != nil {
			s.logRepo.RecordWithActor("feishu_bind", fmt.Sprintf("user:%s(%d)", user.Username, user.ID), actor, false, err.Error(), 0)
			return nil, err
		}
		user.FeishuOpenID = strings.TrimSpace(profile.OpenID)
		user.FeishuUnionID = strings.TrimSpace(profile.UnionID)
		user.FeishuBoundAt = &now
	} else if previousEmail == "" || !strings.EqualFold(previousEmail, normalizedEmail) {
		user.FeishuOpenID = ""
		user.FeishuUnionID = ""
		user.FeishuBoundAt = nil
	}
	if err := s.userRepo.Update(user); err != nil {
		s.logRepo.RecordWithActor("feishu_bind", fmt.Sprintf("user:%s(%d)", user.Username, user.ID), actor, false, err.Error(), 0)
		return nil, err
	}

	if user.FeishuOpenID != "" {
		s.logRepo.RecordWithActor("feishu_bind", fmt.Sprintf("user:%s(%d)", user.Username, user.ID), actor, true, fmt.Sprintf("Feishu bound, email=%s open_id=%s", maskEmail(user.FeishuEmail), maskID(user.FeishuOpenID)), 0)
	} else {
		s.logRepo.RecordWithActor("feishu_bind", fmt.Sprintf("user:%s(%d)", user.Username, user.ID), actor, true, fmt.Sprintf("Feishu email verified, waiting for the first direct message to finish binding, email=%s", maskEmail(user.FeishuEmail)), 0)
	}
	return user, nil
}

func (s *FeishuService) UnbindUser(userID uint, actor string) (*entity.User, error) {
	user, err := s.userRepo.FindByID(userID)
	if err != nil {
		return nil, fmt.Errorf("user not found")
	}

	user.FeishuOpenID = ""
	user.FeishuUnionID = ""
	user.FeishuChatID = ""
	user.FeishuBoundAt = nil
	if err := s.userRepo.Update(user); err != nil {
		return nil, err
	}

	s.logRepo.RecordWithActor("feishu_unbind", fmt.Sprintf("user:%s(%d)", user.Username, user.ID), actor, true, "clear the Feishu binding", 0)
	return user, nil
}

func (s *FeishuService) PushSubscriptionToUserID(userID uint, actor string) (*dto.FeishuPushResponse, error) {
	if !s.IsEnabled() {
		return nil, fmt.Errorf("Feishu integration is currently disabled")
	}
	status := s.GetStatus()
	if !status.Configured {
		return nil, fmt.Errorf("Feishu configuration is incomplete: %s", strings.Join(status.MissingKeys, "、"))
	}

	user, err := s.userRepo.FindByID(userID)
	if err != nil {
		return nil, fmt.Errorf("user not found")
	}

	result := &dto.FeishuPushResponse{Total: 1}
	receiveID, receiveType, ok := s.resolveRecipient(user)
	if !ok {
		result.Skipped = 1
		result.Errors = []string{fmt.Sprintf("user %s has no usable Feishu identity bound", user.Username)}
		return result, nil
	}

	if err := s.sendSubscriptionContent(receiveID, receiveType, user); err != nil {
		result.Failed = 1
		result.Errors = []string{fmt.Sprintf("push to user %s failed: %v", user.Username, err)}
		s.logRepo.RecordWithActor("feishu_push", fmt.Sprintf("user:%s(%d)", user.Username, user.ID), actor, false, err.Error(), 0)
		return result, nil
	}

	result.Sent = 1
	s.logRepo.RecordWithActor("feishu_push", fmt.Sprintf("user:%s(%d)", user.Username, user.ID), actor, true, "Feishu subscription push succeeded", 0)
	return result, nil
}

func (s *FeishuService) PushSubscriptionToUsers(userIDs []uint, actor string) (*dto.FeishuPushResponse, error) {
	if !s.IsEnabled() {
		return nil, fmt.Errorf("Feishu integration is currently disabled")
	}
	status := s.GetStatus()
	if !status.Configured {
		return nil, fmt.Errorf("Feishu configuration is incomplete: %s", strings.Join(status.MissingKeys, "、"))
	}

	users, err := s.userRepo.FindByIDs(userIDs)
	if err != nil {
		return nil, err
	}

	result := &dto.FeishuPushResponse{Total: len(users)}
	for i := range users {
		user := &users[i]
		receiveID, receiveType, ok := s.resolveRecipient(user)
		if !ok {
			result.Skipped++
			result.Errors = append(result.Errors, fmt.Sprintf("user %s has no usable Feishu identity bound", user.Username))
			continue
		}
		if err := s.sendSubscriptionContent(receiveID, receiveType, user); err != nil {
			result.Failed++
			result.Errors = append(result.Errors, fmt.Sprintf("push to user %s failed: %v", user.Username, err))
			s.logRepo.RecordWithActor("feishu_push", fmt.Sprintf("user:%s(%d)", user.Username, user.ID), actor, false, err.Error(), 0)
			continue
		}
		result.Sent++
		s.logRepo.RecordWithActor("feishu_push", fmt.Sprintf("user:%s(%d)", user.Username, user.ID), actor, true, "Feishu subscription push succeeded", 0)
	}
	return result, nil
}

// GetUserProfile 拉取飞书用户资料；actor 为触发方（管理员绑定 / 飞书 webhook）
func (s *FeishuService) GetUserProfile(openID string, actor string) (*FeishuUserProfile, error) {
	token, err := s.getTenantAccessToken()
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(
		http.MethodGet,
		"https://open.feishu.cn/open-apis/contact/v3/users/"+openID+"?user_id_type=open_id",
		nil,
	)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		s.logRepo.RecordWithActor("feishu_profile_fetch", "contact_api", actor, false, "failed to call the Feishu user profile API: "+err.Error(), 0)
		return nil, fmt.Errorf("failed to fetch the Feishu user profile: %w", err)
	}
	defer resp.Body.Close()

	var payload struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			User FeishuUserProfile `json:"user"`
		} `json:"data"`
	}
	if decodeErr := json.NewDecoder(resp.Body).Decode(&payload); decodeErr != nil {
		s.logRepo.RecordWithActor("feishu_profile_fetch", "contact_api", actor, false, "failed to parse the Feishu user profile: "+decodeErr.Error(), 0)
		return nil, fmt.Errorf("failed to parse the Feishu user profile: %w", decodeErr)
	}
	if resp.StatusCode >= 300 || payload.Code != 0 {
		s.logRepo.RecordWithActor("feishu_profile_fetch", "contact_api", actor, false, "the Feishu user profile API returned an error: "+payload.Msg, 0)
		return nil, fmt.Errorf("failed to fetch the Feishu user profile: %s", payload.Msg)
	}
	s.logRepo.RecordWithActor("feishu_profile_fetch", "contact_api", actor, true, fmt.Sprintf("fetched the Feishu user profile, open_id=%s email=%s enterprise_email=%s", maskID(openID), maskEmail(payload.Data.User.Email), maskEmail(payload.Data.User.EnterpriseEmail)), 0)
	return &payload.Data.User, nil
}

func (s *FeishuService) ResolveAuthorizedUser(openID, unionID string) (*entity.User, error) {
	user, err := s.FindBoundUser(openID, unionID)
	if err == nil && user != nil {
		return user, nil
	}

	profile, profileErr := s.GetUserProfile(openID, actorFeishuWebhook)
	if profileErr != nil {
		s.logRepo.RecordWithActor("feishu_bind", "webhook", actorFeishuWebhook, false, "failed to fetch the Feishu profile: "+profileErr.Error(), 0)
		return nil, profileErr
	}

	email := normalizeEmail(profile.Email)
	if email == "" {
		email = normalizeEmail(profile.EnterpriseEmail)
	}
	if email == "" {
		s.logRepo.RecordWithActor("feishu_bind", "webhook", actorFeishuWebhook, false, fmt.Sprintf("the Feishu profile returned no email, open_id=%s", maskID(openID)), 0)
		return nil, fmt.Errorf("the Feishu profile returned no email")
	}
	s.logRepo.RecordWithActor("feishu_bind", "webhook", actorFeishuWebhook, true, fmt.Sprintf("first direct message identified a Feishu email, email=%s open_id=%s", maskEmail(email), maskID(openID)), 0)

	user, err = s.userRepo.FindByFeishuEmail(email)
	if err != nil {
		s.logRepo.RecordWithActor("feishu_bind", "webhook", actorFeishuWebhook, false, fmt.Sprintf("failed to match a panel user by Feishu email, email=%s err=%v", maskEmail(email), err), 0)
		return nil, err
	}
	if !user.FeishuEnabled {
		s.logRepo.RecordWithActor("feishu_bind", fmt.Sprintf("user:%s(%d)", user.Username, user.ID), actorFeishuWebhook, false, fmt.Sprintf("the Feishu email matched but the user has Feishu messaging disabled, email=%s", maskEmail(email)), 0)
		return user, nil
	}

	changed := false
	if strings.TrimSpace(user.FeishuEmail) == "" {
		user.FeishuEmail = email
		changed = true
	}
	if strings.TrimSpace(user.FeishuOpenID) == "" && strings.TrimSpace(openID) != "" {
		user.FeishuOpenID = strings.TrimSpace(openID)
		changed = true
	}
	if strings.TrimSpace(user.FeishuUnionID) == "" && strings.TrimSpace(unionID) != "" {
		user.FeishuUnionID = strings.TrimSpace(unionID)
		changed = true
	}
	if user.FeishuBoundAt == nil && (user.FeishuOpenID != "" || user.FeishuUnionID != "") {
		now := time.Now()
		user.FeishuBoundAt = &now
		changed = true
	}
	if changed {
		if err := s.userRepo.Update(user); err != nil {
			s.logRepo.RecordWithActor("feishu_bind", fmt.Sprintf("user:%s(%d)", user.Username, user.ID), actorFeishuWebhook, false, "failed to complete the Feishu identity on the first direct message: "+err.Error(), 0)
			return nil, err
		}
		s.logRepo.RecordWithActor("feishu_bind", fmt.Sprintf("user:%s(%d)", user.Username, user.ID), actorFeishuWebhook, true, fmt.Sprintf("completed the Feishu identity on the first direct message, email=%s open_id=%s", maskEmail(email), maskID(user.FeishuOpenID)), 0)
	}
	return user, nil
}

func (s *FeishuService) getTenantAccessToken() (string, error) {
	appID := strings.TrimSpace(s.settingSvc.Get(KeyFeishuAppID))
	appSecret := strings.TrimSpace(s.settingSvc.Get(KeyFeishuAppSecret))
	if appID == "" || appSecret == "" {
		return "", fmt.Errorf("Feishu App ID / App Secret is not configured")
	}

	body, err := json.Marshal(map[string]string{
		"app_id":     appID,
		"app_secret": appSecret,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest(
		http.MethodPost,
		"https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
		bytes.NewReader(body),
	)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to obtain the Feishu tenant_access_token: %w", err)
	}
	defer resp.Body.Close()

	var payload struct {
		Code              int    `json:"code"`
		Msg               string `json:"msg"`
		TenantAccessToken string `json:"tenant_access_token"`
	}
	if decodeErr := json.NewDecoder(resp.Body).Decode(&payload); decodeErr != nil {
		return "", fmt.Errorf("failed to parse the Feishu token response: %w", decodeErr)
	}
	if resp.StatusCode >= 300 || payload.Code != 0 || payload.TenantAccessToken == "" {
		return "", fmt.Errorf("failed to obtain the Feishu token: %s", payload.Msg)
	}
	return payload.TenantAccessToken, nil
}
