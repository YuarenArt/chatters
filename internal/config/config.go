package config

import (
	"flag"
	"os"
	"sync"
)

// Config содержит настройки сервера, базы данных и клиента
// Теперь включает APIURL для client
type Config struct {
	Port      string
	JWTSecret string
}

var (
	instance *Config
	once     sync.Once
	parsed   bool
)

// NewConfig загружает конфигурацию из окружения или флагов
// Использует sync.Once для thread-safe singleton pattern
func NewConfig() *Config {
	once.Do(func() {
		instance = &Config{
			Port:      configValue("PORT", "port", "8080", "HTTP server port"),
			JWTSecret: configValue("SECRET_KEY", "jwt-secret", "supersecret", "JWT secret key"),
		}
	})
	return instance
}

// configValue returns the value of a parameter based on the following priority:
// 1. Environment variable.
// 2. Command-line flag.
// 3. Default value.
func configValue(envVar, flagName, defaultValue, description string) string {
	envValue := os.Getenv(envVar)
	if envValue != "" {
		return envValue
	}

	// Create command-line flag only once
	if !parsed {
		flag.String(flagName, defaultValue, description)
		parsed = true
		flag.Parse()
	}

	// Get the flag value
	flagValue := flag.Lookup(flagName)
	if flagValue != nil {
		return flagValue.Value.String()
	}

	return defaultValue
}
