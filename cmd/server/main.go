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
// setupProfiling configures runtime profiling if enabled
func setupProfiling(cfg *config.Config) {
	if !cfg.IsProfilingEnabled() {
		return
	}

	runtime.SetBlockProfileRate(1)
	runtime.SetMutexProfileFraction(1)
	runtime.MemProfileRate = 1

	go startPprofServer()
}

// startPprofServer starts the pprof HTTP server
func startPprofServer() {
	logger, _ := logging.NewFileLogger("logs/pprof.log", true)
	logger.Info(context.Background(), "Starting pprof server", "addr", "localhost:6060")

	if err := http.ListenAndServe("localhost:6060", nil); err != nil {
		logger.Error(context.Background(), "pprof server failed", "error", err)
	}
}

// initializeLogger creates and returns the main server logger
func initializeLogger() (logging.Logger, error) {
	logger, err := logging.NewFileLogger("logs/server.log", true)
	if err != nil {
		return nil, err
	}
	return logger, nil
}

// initializeTaskPool creates and configures the task pool
func initializeTaskPool(ctx context.Context, cfg *config.Config, logger logging.Logger) (*websocket.TaskPool, error) {
	taskPoolSize, err := strconv.Atoi(cfg.TaskPoolSize)
	if err != nil {
		return nil, err
	}

	taskPool, err := websocket.NewTaskPool(taskPoolSize)
	if err != nil {
		logger.Error(ctx, "Failed to initialize task pool", "error", err.Error())
		return nil, err
	}

	return taskPool, nil
}

// createWebSocketHandler creates the WebSocket handler with hub and pool
func createWebSocketHandler(taskPool *websocket.TaskPool) *websocket.Handler {
	hub := websocket.NewHub()
	return websocket.NewHandler(hub, taskPool)
}

// setupSignalHandler creates and configures OS signal handling
func setupSignalHandler() chan os.Signal {
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	return quit
}

// runServerAsync starts the server in a goroutine and returns error channel
func runServerAsync(ctx context.Context, srv *server.Server, logger logging.Logger, port string) <-chan error {
	serverErrCh := make(chan error, 1)

	go func() {
		logger.Info(ctx, "Starting server", "port", port)
		if err := srv.Run(ctx); err != nil {
			serverErrCh <- err
		}
		close(serverErrCh)
	}()

	return serverErrCh
}

// waitForShutdownSignal waits for either shutdown signal or server error
func waitForShutdownSignal(ctx context.Context, logger logging.Logger, quit <-chan os.Signal, serverErrCh <-chan error, cancel context.CancelFunc) bool {
	select {
	case <-quit:
		logger.Info(ctx, "Received shutdown signal")
		cancel()
		return true
	case err := <-serverErrCh:
		if err != nil {
			logger.Error(ctx, "Server failed", "error", err.Error())
			return false
		}
		return true
	}
}

// performGracefulShutdown executes graceful server shutdown
func performGracefulShutdown(ctx context.Context, srv *server.Server, logger logging.Logger) error {
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	logger.Info(ctx, "Shutting down server gracefully...")

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error(ctx, "Server forced to shutdown", "error", err.Error())
		return err
	}

	logger.Info(ctx, "Server exited successfully")
	return nil
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cfg := config.NewConfig()
	setupProfiling(cfg)

	logger, err := initializeLogger()
	if err != nil {
		panic("Failed to initialize logger: " + err.Error())
	}

	taskPool, err := initializeTaskPool(ctx, cfg, logger)
	if err != nil {
		panic("Failed to initialize task pool: " + err.Error())
	}
	defer taskPool.Release()

	wsHandler := createWebSocketHandler(taskPool)
	srv := server.NewServer(":"+cfg.Port, *wsHandler, logger, cfg)

	quit := setupSignalHandler()
	serverErrCh := runServerAsync(ctx, srv, logger, cfg.Port)

	if !waitForShutdownSignal(ctx, logger, quit, serverErrCh, cancel) {
		os.Exit(1)
	}

	if err := performGracefulShutdown(ctx, srv, logger); err != nil {
		os.Exit(1)
	}
}
