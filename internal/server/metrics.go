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

// Metrics holds Prometheus metrics for HTTP and WebSocket monitoring
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

// NewMetrics initializes and registers all metrics
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

	go m.startRuntimeMetricsUpdater(5 * time.Second)

	return m
}

// PrometheusMiddleware collects HTTP metrics for each request
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

// MetricsHandler returns a handler for Prometheus metrics endpoint
func (m *Metrics) MetricsHandler() gin.HandlerFunc {
	h := promhttp.Handler()
	return func(c *gin.Context) {
		h.ServeHTTP(c.Writer, c.Request)
	}
}

// UpdateRuntimeMetrics updates runtime metrics like memory, goroutines, and CPU usage
func (m *Metrics) UpdateRuntimeMetrics() {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	m.Goroutines.Set(float64(runtime.NumGoroutine()))
	m.MemoryAlloc.Set(float64(mem.Alloc))
	m.HeapAlloc.Set(float64(mem.HeapAlloc))

	p, err := process.NewProcess(int32(os.Getpid()))
	if err == nil {
		if percent, err := p.CPUPercent(); err == nil {
			m.CPUUsage.Set(percent)
		}
	}
}

// startRuntimeMetricsUpdater periodically updates runtime metrics
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

// DroppedMessage increments WebSocket dropped message counter
func (m *Metrics) DroppedMessage(roomID string, clientID string) {
	m.WSMessages.WithLabelValues("dropped").Inc()
}

// Stop stops runtime metrics updater
func (m *Metrics) Stop() {
	close(m.stopChan)
}
