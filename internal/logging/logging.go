package logging

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
)

type Level int

const (
	Debug Level = -4
	Info  Level = 0
	Warn  Level = 4
	Error Level = 8
)

// Logger defines the interface for structured logging.
type Logger interface {
	Debug(msg string, keysAndValues ...interface{})
	Info(msg string, keysAndValues ...interface{})
	Warn(msg string, keysAndValues ...interface{})
	Error(msg string, keysAndValues ...interface{})
	Log(level Level, msg string, keysAndValues ...interface{})
}

func NewLogger() Logger {
	return newSlogLogger(os.Stdout)
}

// NewFileLogger создает логгер, пишущий в файл
func NewFileLogger(logFile string) Logger {
	writer := setupFileWriter(logFile)
	return newSlogLogger(writer)
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

func setupFileWriter(logFile string) io.Writer {
	logDir := filepath.Dir(logFile)
	if err := os.MkdirAll(logDir, 0755); err != nil {
		slog.Error("Failed to create log directory", "error", err, "path", logDir)
		return os.Stdout
	}

	file, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		slog.Error("Failed to open log file", "error", err, "path", logFile)
		return os.Stdout
	}

	return file
}

func (l *SlogLogger) Debug(msg string, keysAndValues ...interface{}) {
	l.logger.Debug(msg, keysAndValues...)
}

func (l *SlogLogger) Info(msg string, keysAndValues ...interface{}) {
	l.logger.Info(msg, keysAndValues...)
}

func (l *SlogLogger) Warn(msg string, keysAndValues ...interface{}) {
	l.logger.Warn(msg, keysAndValues...)
}

func (l *SlogLogger) Error(msg string, keysAndValues ...interface{}) {
	l.logger.Error(msg, keysAndValues...)
}

func (l *SlogLogger) Log(level Level, msg string, keysAndValues ...interface{}) {
	if l != nil && l.logger != nil {
		l.logger.Log(context.Background(), slog.Level(level), msg, keysAndValues...)
	}
}
