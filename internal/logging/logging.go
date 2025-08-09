package logging

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
)

type Level int
type keyType string

const (
	Debug Level = -4
	Info  Level = 0
	Warn  Level = 4
	Error Level = 8

	loggerKey keyType = "logger"
)

// Logger defines the interface for structured logging.
type Logger interface {
	Debug(ctx context.Context, msg string, keysAndValues ...interface{})
	Info(ctx context.Context, msg string, keysAndValues ...interface{})
	Warn(ctx context.Context, msg string, keysAndValues ...interface{})
	Error(ctx context.Context, msg string, keysAndValues ...interface{})
	Log(ctx context.Context, level Level, msg string, keysAndValues ...interface{})
}

func NewLogger() Logger {
	return newSlogLogger(os.Stdout)
}

// NewFileLogger создает логгер, пишущий в файл
func NewFileLogger(logFile string, logToConsole bool) (Logger, error) {
	writer, err := setupFileWriter(logFile, logToConsole)
	if err != nil {
		return nil, err
	}
	return newSlogLogger(writer), nil
}

type SlogLogger struct {
	logger *slog.Logger
}

func newSlogLogger(writer io.Writer) Logger {
	handler := slog.NewJSONHandler(writer, &slog.HandlerOptions{})
	return &SlogLogger{
		logger: slog.New(handler),
	}
}

func setupFileWriter(logFile string, logToConsole bool) (io.Writer, error) {
	logDir := filepath.Dir(logFile)
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create log directory %s: %w", logDir, err)
	}

	file, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to open log file %s: %w", logFile, err)
	}

	if logToConsole {
		return io.MultiWriter(file, os.Stdout), nil
	}
	return file, nil
}

func (l *SlogLogger) Debug(ctx context.Context, msg string, keysAndValues ...interface{}) {
	l.Log(ctx, Debug, msg, keysAndValues...)
}

func (l *SlogLogger) Info(ctx context.Context, msg string, keysAndValues ...interface{}) {
	l.Log(ctx, Info, msg, keysAndValues...)
}

func (l *SlogLogger) Warn(ctx context.Context, msg string, keysAndValues ...interface{}) {
	l.Log(ctx, Warn, msg, keysAndValues...)
}

func (l *SlogLogger) Error(ctx context.Context, msg string, keysAndValues ...interface{}) {
	l.Log(ctx, Error, msg, keysAndValues...)
}

func (l *SlogLogger) Log(ctx context.Context, level Level, msg string, keysAndValues ...interface{}) {
	if l != nil && l.logger != nil {
		if requestID, ok := ctx.Value("request_id").(string); ok {
			keysAndValues = append(keysAndValues, "request_id", requestID)
		}
		l.logger.Log(ctx, slog.Level(level), msg, keysAndValues...)
	}
}
