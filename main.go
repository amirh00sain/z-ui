package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/imrui/xray-pilot/config"
	"github.com/imrui/xray-pilot/internal/handler"
	"github.com/imrui/xray-pilot/internal/repository"
	"github.com/imrui/xray-pilot/internal/scheduler"
	"github.com/imrui/xray-pilot/internal/service"
	"github.com/imrui/xray-pilot/pkg/logger"
)

//go:embed frontend/dist
var frontendFS embed.FS

// release-notes 打进二进制：更新日志接口的内容与发布版本天然一致，无需部署额外文件
//
//go:embed release-notes/v*.md
var releaseNotesFS embed.FS

var Version = "dev"

func main() {
	// 1. 加载配置
	if err := config.Load(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
		os.Exit(1)
	}

	// 2. 初始化日志
	if err := logger.Init(config.Global.Server.Mode); err != nil {
		fmt.Fprintf(os.Stderr, "failed to initialise logging: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()
	log := logger.Log

	// 3. 连接数据库
	if err := repository.Connect(); err != nil {
		log.Fatal("database initialisation failed", zap.Error(err))
	}
	log.Info("database connected", zap.String("driver", config.Global.Database.Driver))

	// 4. 将 config.yaml 中的运行时配置 / 管理员账号种入数据库（仅首次启动，已有则跳过）
	service.NewSettingService().SeedFromConfig()
	if err := service.NewAdminService().SeedFromConfig(); err != nil {
		log.Fatal("admin account initialisation failed", zap.Error(err))
	}

	// 5. 启动定时任务（漂移检测 + 健康检测）
	schedCtx, schedCancel := context.WithCancel(context.Background())
	defer schedCancel()
	scheduler.New().Start(schedCtx)

	// 5. 初始化路由
	gin.SetMode(config.Global.Server.Mode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	notesFS, err := fs.Sub(releaseNotesFS, "release-notes")
	if err != nil {
		log.Warn("failed to load the release-notes assets; the changelog endpoint will return an empty list", zap.Error(err))
		notesFS = nil
	}
	handler.RegisterRoutes(r, notesFS)

	// 6. 挂载前端静态文件（embed）
	distFS, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		log.Warn("failed to load the frontend assets (ignorable in development mode)", zap.Error(err))
	} else {
		// /assets/* → frontend/dist/assets/
		assetsFS, _ := fs.Sub(distFS, "assets")
		r.StaticFS("/assets", http.FS(assetsFS))

		// 根目录静态资源：避免 favicon.svg / icons.svg 被 SPA fallback 吞掉
		for _, name := range []string{"favicon.svg", "icons.svg"} {
			name := name
			r.GET("/"+name, func(c *gin.Context) {
				data, readErr := fs.ReadFile(distFS, name)
				if readErr != nil {
					c.Status(http.StatusNotFound)
					return
				}
				switch name {
				case "favicon.svg", "icons.svg":
					c.Data(http.StatusOK, "image/svg+xml; charset=utf-8", data)
				default:
					c.Data(http.StatusOK, "application/octet-stream", data)
				}
			})
		}

		// 直接读取 index.html 字节，避免 http.FileServer 产生 301 重定向
		indexHTML, _ := fs.ReadFile(distFS, "index.html")
		serveSPA := func(c *gin.Context) {
			c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
		}
		r.GET("/", serveSPA)
		// SPA fallback：所有未匹配路由返回 index.html，由前端路由处理
		r.NoRoute(serveSPA)
	}

	// 7. 启动 HTTP 服务器
	addr := fmt.Sprintf(":%d", config.Global.Server.Port)
	srv := &http.Server{Addr: addr, Handler: r}
	log.Info("server started", zap.String("addr", addr), zap.String("version", Version))

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("server failed to start", zap.Error(err))
		}
	}()

	// 8. 优雅关闭
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("shutting down...")
	schedCancel() // 先停定时任务
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutCancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		log.Error("error while shutting down", zap.Error(err))
	}
	log.Info("server exited")
}
