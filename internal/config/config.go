package config

import (
	"flag"
	"os"
	"sync"
)

type Config struct {
	Port         string
	JWTSecret    string
	TaskPoolSize string
	Profiling    string
}

var (
	instance *Config
	once     sync.Once
	parsed   bool
)

// NewConfig загружает конфигурацию из окружения или флагов
func NewConfig() *Config {
	once.Do(func() {
		instance = &Config{
			Port:         configValue("PORT", "port", "8080", "HTTP server port"),
			JWTSecret:    configValue("SECRET_KEY", "jwt-secret", "supersecret", "JWT secret key"),
			TaskPoolSize: configValue("TASK_POOL_SIZE", "task-pool-size", "10000", "size of task pool"),
			Profiling:    configValue("PROFILING", "profiling", "false", "enable pprof profiling (true/false)"),
		}
	})
	return instance
}

// IsProfilingEnabled returns true if profiling is enabled in the config
func (c *Config) IsProfilingEnabled() bool {
	switch c.Profiling {
	case "true", "1", "yes", "on":
		return true
	default:
		return false
	}
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
