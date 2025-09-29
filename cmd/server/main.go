package main

import (
	"context"
	"net/http"
	_ "net/http/pprof"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"syscall"
	"time"

	_ "github.com/YuarenArt/chatters/docs"
	"github.com/YuarenArt/chatters/internal/config"
	"github.com/YuarenArt/chatters/internal/logging"
	"github.com/YuarenArt/chatters/internal/server"
	"github.com/YuarenArt/chatters/pkg/websocket"
)

// @title           Chatters API
// @version         0.1.3
// @description     Realtime chat rooms with WebSocket and REST
// @BasePath        /
// @host            localhost:8080
func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cfg := config.NewConfig()

	if cfg.IsProfilingEnabled() {
		runtime.SetBlockProfileRate(1)
		runtime.SetMutexProfileFraction(1)
		runtime.MemProfileRate = 1

		go func() {
			logger, _ := logging.NewFileLogger("logs/pprof.log", true)
			logger.Info(context.Background(), "Starting pprof server", "addr", "localhost:6060")
			if err := http.ListenAndServe("localhost:6060", nil); err != nil {
				logger.Error(context.Background(), "pprof server failed", "error", err)
			}
		}()
	}

	logger, err := logging.NewFileLogger("logs/server.log", true)
	if err != nil {
		panic("Failed to initialize logger: " + err.Error())
	}

	taskPoolSize, err := strconv.Atoi(cfg.TaskPoolSize)
	if err != nil {
		panic("Failed to parse task pool size: " + err.Error())
	}
	taskPool, err := websocket.NewTaskPool(taskPoolSize)
	if err != nil {
		logger.Error(ctx, "Failed to initialize task pool", "error", err.Error())
		panic("Failed to initialize task pool: " + err.Error())
	}
	defer taskPool.Release()

	hub := websocket.NewHub()
	wsHandler := websocket.NewHandler(hub, taskPool)

	srv := server.NewServer(":"+cfg.Port, *wsHandler, logger, cfg)
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	serverErrCh := make(chan error, 1)
	go func() {
		logger.Info(ctx, "Starting server", "port", cfg.Port)
		if err := srv.Run(ctx); err != nil {
			serverErrCh <- err
		}
		close(serverErrCh)
	}()

	select {
	case <-quit:
		logger.Info(ctx, "Received shutdown signal")
		cancel()
	case err := <-serverErrCh:
		if err != nil {
			logger.Error(ctx, "Server failed", "error", err.Error())
			os.Exit(1)
		}
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	logger.Info(ctx, "Shutting down server gracefully...")

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error(ctx, "Server forced to shutdown", "error", err.Error())
	}

	logger.Info(ctx, "Server exited successfully")
}
