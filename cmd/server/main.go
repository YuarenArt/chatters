package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/YuarenArt/chatters/docs"
	"github.com/YuarenArt/chatters/internal/config"
	"github.com/YuarenArt/chatters/internal/logging"
	"github.com/YuarenArt/chatters/internal/server"
	"github.com/YuarenArt/chatters/pkg/websocket"
)

// @title           Chatters Chat API
// @version         1.0.0
// @description     Real-time chat application API with WebSocket support for instant messaging and room management
// @BasePath        /
// @host            localhost:8080
// @schemes         http https
// @contact.name    Chatters Development Team
// @contact.url     https://github.com/YuarenArt/chatters
// @license.name    MIT
// @license.url     https://opensource.org/licenses/MIT
// @termsOfService  https://github.com/YuarenArt/chatters/blob/main/LICENSE
func main() {
	ctx := context.Background()
	cfg := config.NewConfig()

	logger, err := logging.NewFileLogger("logs/server.log", true)
	if err != nil {
		panic("Failed to initialize logger: " + err.Error())
	}

	taskPool, err := websocket.NewTaskPool(100)
	if err != nil {
		logger.Error(ctx, "Failed to initialize task pool", "error", err.Error())
		panic("Failed to initialize task pool: " + err.Error())
	}
	defer taskPool.Release()

	hub := websocket.NewHub()
	wsHandler := websocket.NewHandler(hub, taskPool)
	srv := server.NewServer(":"+cfg.Port, *wsHandler, logger)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		logger.Info(ctx, "Starting server", "port", cfg.Port)
		if err := srv.Run(ctx); err != nil {
			logger.Error(ctx, "Server failed to start", "error", err.Error())
			os.Exit(1)
		}
	}()

	<-quit
	logger.Info(ctx, "Shutting down server...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error(ctx, "Server forced to shutdown", "error", err.Error())
	}

	logger.Info(ctx, "Server exited")
}
