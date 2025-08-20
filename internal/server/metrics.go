package server

import (
	"os"
	"runtime"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/shirou/gopsutil/v3/process"
)

type Metrics struct {
	RequestDuration *prometheus.HistogramVec
	RequestCounter  *prometheus.CounterVec
	WSConnections   prometheus.Gauge
	WSMessages      *prometheus.CounterVec
	Goroutines      prometheus.Gauge
	MemoryAlloc     prometheus.Gauge
	HeapAlloc       prometheus.Gauge
	CPUUsage        prometheus.Gauge
	stopChan        chan struct{}
}

func NewMetrics() *Metrics {
	m := &Metrics{
		RequestDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "http_request_duration_seconds",
				Help:    "Duration of HTTP requests",
				Buckets: prometheus.ExponentialBuckets(0.01, 2, 15),
			},
			[]string{"method", "path", "status"},
		),
		RequestCounter: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "http_requests_total",
				Help: "Total number of HTTP requests",
			},
			[]string{"method", "path", "status"},
		),
		WSConnections: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "ws_active_connections",
			Help: "Number of active WebSocket connections",
		}),
		WSMessages: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "ws_messages_total",
				Help: "Total number of WebSocket messages",
			},
			[]string{"direction"},
		),
		Goroutines: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "goroutines",
			Help: "Number of active goroutines",
		}),
		MemoryAlloc: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "go_mem_alloc_bytes",
			Help: "Memory allocated and still in use",
		}),
		HeapAlloc: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "go_heap_alloc_bytes",
			Help: "Heap memory allocated",
		}),
		CPUUsage: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "process_cpu_percent",
			Help: "CPU usage of the process in percent",
		}),
		stopChan: make(chan struct{}),
	}

	// Регистрация всех метрик в Prometheus
	prometheus.MustRegister(
		m.Goroutines,
		m.MemoryAlloc,
		m.HeapAlloc,
		m.CPUUsage,
		m.RequestCounter,
		m.RequestDuration,
		m.WSConnections,
		m.WSMessages,
	)

	// Фоновое обновление runtime метрик каждые 5 секунд
	go m.startRuntimeMetricsUpdater(5 * time.Second)

	return m
}

// Middleware для Gin, собирает HTTP метрики
func (m *Metrics) PrometheusMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		latency := time.Since(start).Seconds()

		status := c.Writer.Status()
		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}

		m.RequestDuration.WithLabelValues(c.Request.Method, path, strconv.Itoa(status)).Observe(latency)
		m.RequestCounter.WithLabelValues(c.Request.Method, path, strconv.Itoa(status)).Inc()
	}
}

// Handler для /metrics
func (m *Metrics) MetricsHandler() gin.HandlerFunc {
	h := promhttp.Handler()
	return func(c *gin.Context) {
		h.ServeHTTP(c.Writer, c.Request)
	}
}

// Обновление runtime метрик
func (m *Metrics) UpdateRuntimeMetrics() {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	m.Goroutines.Set(float64(runtime.NumGoroutine()))
	m.MemoryAlloc.Set(float64(mem.Alloc))
	m.HeapAlloc.Set(float64(mem.HeapAlloc))

	// CPU usage
	p, err := process.NewProcess(int32(os.Getpid()))
	if err == nil {
		if percent, err := p.CPUPercent(); err == nil {
			m.CPUUsage.Set(percent)
		}
	}
}

// Фоновый обновлятор метрик
func (m *Metrics) startRuntimeMetricsUpdater(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			m.UpdateRuntimeMetrics()
		case <-m.stopChan:
			return
		}
	}
}

// Остановка фонового обновления
func (m *Metrics) Stop() {
	close(m.stopChan)
}
