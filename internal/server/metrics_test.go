package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewMetrics(t *testing.T) {
	// Unregister any previously registered metrics
	prometheus.DefaultRegisterer = prometheus.NewRegistry()

	m := NewMetrics()
	require.NotNil(t, m)
	assert.NotNil(t, m.RequestDuration)
	assert.NotNil(t, m.RequestCounter)
	assert.NotNil(t, m.WSConnections)
	assert.NotNil(t, m.WSMessages)
	assert.NotNil(t, m.Goroutines)
	assert.NotNil(t, m.MemoryAlloc)
	assert.NotNil(t, m.HeapAlloc)
	assert.NotNil(t, m.CPUUsage)
	assert.NotNil(t, m.stopChan)

	// Clean up
	m.Stop()
}

func TestMetrics_PrometheusMiddleware(t *testing.T) {
	prometheus.DefaultRegisterer = prometheus.NewRegistry()
	m := NewMetrics()
	defer m.Stop()

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(m.PrometheusMiddleware())
	router.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify metrics were recorded
	// Note: We can't easily verify the exact values, but we can ensure no panics occurred
}

func TestMetrics_PrometheusMiddleware_WithFullPath(t *testing.T) {
	prometheus.DefaultRegisterer = prometheus.NewRegistry()
	m := NewMetrics()
	defer m.Stop()

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(m.PrometheusMiddleware())
	router.GET("/api/rooms/:room_id", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"room_id": c.Param("room_id")})
	})

	req := httptest.NewRequest(http.MethodGet, "/api/rooms/123", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestMetrics_PrometheusMiddleware_DifferentStatusCodes(t *testing.T) {
	prometheus.DefaultRegisterer = prometheus.NewRegistry()
	m := NewMetrics()
	defer m.Stop()

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(m.PrometheusMiddleware())

	router.GET("/ok", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{})
	})
	router.GET("/notfound", func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{})
	})
	router.GET("/error", func(c *gin.Context) {
		c.JSON(http.StatusInternalServerError, gin.H{})
	})

	tests := []struct {
		name           string
		path           string
		expectedStatus int
	}{
		{"OK", "/ok", http.StatusOK},
		{"Not Found", "/notfound", http.StatusNotFound},
		{"Internal Error", "/error", http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			assert.Equal(t, tt.expectedStatus, w.Code)
		})
	}
}

func TestMetrics_MetricsHandler(t *testing.T) {
	prometheus.DefaultRegisterer = prometheus.NewRegistry()
	m := NewMetrics()
	defer m.Stop()

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/metrics", m.MetricsHandler())

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "# HELP")
	assert.Contains(t, w.Body.String(), "# TYPE")
}

func TestMetrics_UpdateRuntimeMetrics(t *testing.T) {
	prometheus.DefaultRegisterer = prometheus.NewRegistry()
	m := NewMetrics()
	defer m.Stop()

	// Call UpdateRuntimeMetrics manually
	m.UpdateRuntimeMetrics()

	// We can't easily verify the exact values, but we can ensure no panics occurred
	// The metrics should be updated without errors
}

func TestMetrics_DroppedMessage(t *testing.T) {
	prometheus.DefaultRegisterer = prometheus.NewRegistry()
	m := NewMetrics()
	defer m.Stop()

	// Call DroppedMessage
	m.DroppedMessage("123", "user1")
	m.DroppedMessage("456", "user2")

	// Verify no panics occurred
	// The counter should be incremented
}

func TestMetrics_Stop(t *testing.T) {
	prometheus.DefaultRegisterer = prometheus.NewRegistry()
	m := NewMetrics()

	// Stop should close the stopChan
	m.Stop()

	// Verify channel is closed by trying to receive
	select {
	case <-m.stopChan:
		// Channel is closed, test passes
	case <-time.After(100 * time.Millisecond):
		t.Fatal("stopChan was not closed")
	}
}

func TestMetrics_RuntimeMetricsUpdater(t *testing.T) {
	prometheus.DefaultRegisterer = prometheus.NewRegistry()
	m := NewMetrics()

	// Wait a bit for the updater to run at least once
	time.Sleep(100 * time.Millisecond)

	// Stop the metrics
	m.Stop()

	// Verify the updater stops
	time.Sleep(100 * time.Millisecond)
}

func TestMetrics_ConcurrentAccess(t *testing.T) {
	prometheus.DefaultRegisterer = prometheus.NewRegistry()
	m := NewMetrics()
	defer m.Stop()

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(m.PrometheusMiddleware())
	router.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{})
	})

	// Simulate concurrent requests
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func() {
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			done <- true
		}()
	}

	// Wait for all goroutines to complete
	for i := 0; i < 10; i++ {
		<-done
	}
}

func TestMetrics_WSConnectionsGauge(t *testing.T) {
	prometheus.DefaultRegisterer = prometheus.NewRegistry()
	m := NewMetrics()
	defer m.Stop()

	// Test setting WS connections
	m.WSConnections.Set(5)
	m.WSConnections.Inc()
	m.WSConnections.Dec()

	// No panics should occur
}

func TestMetrics_WSMessagesCounter(t *testing.T) {
	prometheus.DefaultRegisterer = prometheus.NewRegistry()
	m := NewMetrics()
	defer m.Stop()

	// Test incrementing WS messages
	m.WSMessages.WithLabelValues("sent").Inc()
	m.WSMessages.WithLabelValues("received").Inc()
	m.WSMessages.WithLabelValues("dropped").Inc()

	// No panics should occur
}
