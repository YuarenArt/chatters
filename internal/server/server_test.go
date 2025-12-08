package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/YuarenArt/chatters/internal/config"
	"github.com/YuarenArt/chatters/internal/logging"
	"github.com/YuarenArt/chatters/pkg/websocket"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

func setupTestServer(t *testing.T) *Server {
	gin.SetMode(gin.TestMode)
	prometheus.DefaultRegisterer = prometheus.NewRegistry()

	hub := websocket.NewHub()
	pool, err := websocket.NewTaskPool(100)
	require.NoError(t, err)

	handler := websocket.NewHandler(hub, pool)
	logger := logging.NewLogger()
	cfg := &config.Config{
		Port:      "8080",
		JWTSecret: "test-secret-key",
	}

	server := NewServer(":8080", *handler, logger, cfg)
	return server
}

func TestNewServer(t *testing.T) {
	server := setupTestServer(t)
	require.NotNil(t, server)
	assert.NotNil(t, server.Handler)
	assert.NotNil(t, server.Engine)
	assert.NotNil(t, server.Logger)
	assert.NotNil(t, server.Metrics)
	assert.NotNil(t, server.Config)
	assert.Equal(t, ":8080", server.Addr)

	server.Metrics.Stop()
}

func TestServer_HealthCheck(t *testing.T) {
	server := setupTestServer(t)
	defer server.Metrics.Stop()

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	w := httptest.NewRecorder()
	server.Engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)
	assert.Equal(t, "ok", response["status"])
}

func TestServer_CreateRoom(t *testing.T) {
	server := setupTestServer(t)
	defer server.Metrics.Stop()

	tests := []struct {
		name           string
		requestBody    interface{}
		expectedStatus int
		checkResponse  func(t *testing.T, body []byte)
	}{
		{
			name:           "Create room without password",
			requestBody:    CreateRoomRequest{},
			expectedStatus: http.StatusCreated,
			checkResponse: func(t *testing.T, body []byte) {
				var resp CreateRoomResponse
				err := json.Unmarshal(body, &resp)
				require.NoError(t, err)
				assert.NotEmpty(t, resp.HostToken)
				assert.Greater(t, uint32(resp.RoomID), uint32(0))
			},
		},
		{
			name:           "Create room with password",
			requestBody:    CreateRoomRequest{Password: "testpass123"},
			expectedStatus: http.StatusCreated,
			checkResponse: func(t *testing.T, body []byte) {
				var resp CreateRoomResponse
				err := json.Unmarshal(body, &resp)
				require.NoError(t, err)
				assert.NotEmpty(t, resp.HostToken)
				assert.Greater(t, uint32(resp.RoomID), uint32(0))
			},
		},
		{
			name:           "Create room with empty body",
			requestBody:    nil,
			expectedStatus: http.StatusCreated,
			checkResponse: func(t *testing.T, body []byte) {
				var resp CreateRoomResponse
				err := json.Unmarshal(body, &resp)
				require.NoError(t, err)
				assert.NotEmpty(t, resp.HostToken)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var body []byte
			if tt.requestBody != nil {
				body, _ = json.Marshal(tt.requestBody)
			}

			req := httptest.NewRequest(http.MethodPost, "/api/rooms", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			server.Engine.ServeHTTP(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)
			if tt.checkResponse != nil {
				tt.checkResponse(t, w.Body.Bytes())
			}
		})
	}
}

func TestServer_GetRoom(t *testing.T) {
	server := setupTestServer(t)
	defer server.Metrics.Stop()

	// Create a room first
	room, created := server.Handler.Hub.CreateRoom(12345, server.Metrics, websocket.WithHost("test-host"))
	require.True(t, created)
	defer room.StopRoom()

	tests := []struct {
		name           string
		roomID         string
		expectedStatus int
		checkResponse  func(t *testing.T, body []byte)
	}{
		{
			name:           "Get existing room",
			roomID:         "12345",
			expectedStatus: http.StatusOK,
			checkResponse: func(t *testing.T, body []byte) {
				var resp RoomResponse
				err := json.Unmarshal(body, &resp)
				require.NoError(t, err)
				assert.Equal(t, websocket.ID(12345), resp.RoomID)
				assert.Equal(t, "test-host", resp.HostID)
				assert.False(t, resp.HasPassword)
			},
		},
		{
			name:           "Get non-existent room",
			roomID:         "99999",
			expectedStatus: http.StatusNotFound,
			checkResponse: func(t *testing.T, body []byte) {
				var resp ErrorResponse
				err := json.Unmarshal(body, &resp)
				require.NoError(t, err)
				assert.Equal(t, "room not found", resp.Error)
			},
		},
		{
			name:           "Invalid room ID format",
			roomID:         "invalid",
			expectedStatus: http.StatusBadRequest,
			checkResponse: func(t *testing.T, body []byte) {
				var resp ErrorResponse
				err := json.Unmarshal(body, &resp)
				require.NoError(t, err)
				assert.Contains(t, resp.Error, "invalid room ID")
			},
		},
		{
			name:           "Room ID out of range",
			roomID:         "9999999999",
			expectedStatus: http.StatusBadRequest,
			checkResponse: func(t *testing.T, body []byte) {
				var resp ErrorResponse
				err := json.Unmarshal(body, &resp)
				require.NoError(t, err)
				assert.Contains(t, resp.Error, "invalid room ID")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/rooms/"+tt.roomID, nil)
			w := httptest.NewRecorder()
			server.Engine.ServeHTTP(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)
			if tt.checkResponse != nil {
				tt.checkResponse(t, w.Body.Bytes())
			}
		})
	}
}

func TestServer_ValidatePassword(t *testing.T) {
	server := setupTestServer(t)
	defer server.Metrics.Stop()

	// Create room with password
	hashedPassword, _ := hashPassword("testpass123")
	room, created := server.Handler.Hub.CreateRoom(12345, server.Metrics,
		websocket.WithHost("test-host"),
		websocket.WithPassword(hashedPassword))
	require.True(t, created)
	defer room.StopRoom()

	// Create room without password
	roomNoPass, created := server.Handler.Hub.CreateRoom(54321, server.Metrics,
		websocket.WithHost("test-host"))
	require.True(t, created)
	defer roomNoPass.StopRoom()

	tests := []struct {
		name           string
		roomID         string
		requestBody    ValidatePasswordRequest
		expectedStatus int
		expectedValid  bool
	}{
		{
			name:           "Valid password",
			roomID:         "12345",
			requestBody:    ValidatePasswordRequest{Password: "testpass123"},
			expectedStatus: http.StatusOK,
			expectedValid:  true,
		},
		{
			name:           "Invalid password",
			roomID:         "12345",
			requestBody:    ValidatePasswordRequest{Password: "wrongpass"},
			expectedStatus: http.StatusOK,
			expectedValid:  false,
		},
		{
			name:           "Room without password",
			roomID:         "54321",
			requestBody:    ValidatePasswordRequest{},
			expectedStatus: http.StatusOK,
			expectedValid:  true,
		},
		{
			name:           "Non-existent room",
			roomID:         "99999",
			requestBody:    ValidatePasswordRequest{Password: "testpass123"},
			expectedStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(tt.requestBody)
			req := httptest.NewRequest(http.MethodPost, "/api/rooms/"+tt.roomID+"/validate-password", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			server.Engine.ServeHTTP(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)

			if tt.expectedStatus == http.StatusOK {
				var resp map[string]bool
				err := json.Unmarshal(w.Body.Bytes(), &resp)
				require.NoError(t, err)
				assert.Equal(t, tt.expectedValid, resp["valid"])
			}
		})
	}
}

func TestServer_KickUser(t *testing.T) {
	server := setupTestServer(t)
	defer server.Metrics.Stop()

	// Create room
	room, created := server.Handler.Hub.CreateRoom(12345, server.Metrics,
		websocket.WithHost("host-id-123"))
	require.True(t, created)
	defer room.StopRoom()

	// Create valid host token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"room_id": 12345,
		"host_id": "host-id-123",
		"host":    true,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	})
	tokenString, _ := token.SignedString([]byte(server.Config.JWTSecret))

	tests := []struct {
		name           string
		roomID         string
		hostToken      string
		requestBody    KickUserRequest
		expectedStatus int
	}{
		{
			name:           "Kick without host token",
			roomID:         "12345",
			hostToken:      "",
			requestBody:    KickUserRequest{Username: "testuser"},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Kick with invalid token",
			roomID:         "12345",
			hostToken:      "invalid-token",
			requestBody:    KickUserRequest{Username: "testuser"},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Kick non-existent user",
			roomID:         "12345",
			hostToken:      tokenString,
			requestBody:    KickUserRequest{Username: "nonexistent"},
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "Kick from non-existent room",
			roomID:         "99999",
			hostToken:      tokenString,
			requestBody:    KickUserRequest{Username: "testuser"},
			expectedStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(tt.requestBody)
			req := httptest.NewRequest(http.MethodPost, "/api/rooms/"+tt.roomID+"/kick", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", tt.hostToken)
			w := httptest.NewRecorder()
			server.Engine.ServeHTTP(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)
		})
	}
}

func TestServer_ChangePassword(t *testing.T) {
	server := setupTestServer(t)
	defer server.Metrics.Stop()

	// Create room
	room, created := server.Handler.Hub.CreateRoom(12345, server.Metrics,
		websocket.WithHost("host-id-123"))
	require.True(t, created)
	defer room.StopRoom()

	// Create valid host token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"room_id": 12345,
		"host_id": "host-id-123",
		"host":    true,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	})
	tokenString, _ := token.SignedString([]byte(server.Config.JWTSecret))

	tests := []struct {
		name           string
		roomID         string
		hostToken      string
		requestBody    ChangePasswordRequest
		expectedStatus int
		verifyPassword func(t *testing.T)
	}{
		{
			name:           "Set new password",
			roomID:         "12345",
			hostToken:      tokenString,
			requestBody:    ChangePasswordRequest{NewPassword: "newpass123"},
			expectedStatus: http.StatusOK,
			verifyPassword: func(t *testing.T) {
				assert.True(t, room.HasPassword())
				err := bcrypt.CompareHashAndPassword([]byte(room.HashedPassword), []byte("newpass123"))
				assert.NoError(t, err)
			},
		},
		{
			name:           "Remove password",
			roomID:         "12345",
			hostToken:      tokenString,
			requestBody:    ChangePasswordRequest{NewPassword: ""},
			expectedStatus: http.StatusOK,
			verifyPassword: func(t *testing.T) {
				assert.False(t, room.HasPassword())
			},
		},
		{
			name:           "Change password without token",
			roomID:         "12345",
			hostToken:      "",
			requestBody:    ChangePasswordRequest{NewPassword: "newpass"},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Change password for non-existent room",
			roomID:         "99999",
			hostToken:      tokenString,
			requestBody:    ChangePasswordRequest{NewPassword: "newpass"},
			expectedStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(tt.requestBody)
			req := httptest.NewRequest(http.MethodPut, "/api/rooms/"+tt.roomID+"/password", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", tt.hostToken)
			w := httptest.NewRecorder()
			server.Engine.ServeHTTP(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)

			if tt.verifyPassword != nil {
				tt.verifyPassword(t)
			}
		})
	}
}

func TestServer_DeleteRoom(t *testing.T) {
	server := setupTestServer(t)
	defer server.Metrics.Stop()

	// Create room
	room, created := server.Handler.Hub.CreateRoom(12345, server.Metrics,
		websocket.WithHost("host-id-123"))
	require.True(t, created)
	defer room.StopRoom()

	// Create valid host token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"room_id": 12345,
		"host_id": "host-id-123",
		"host":    true,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	})
	tokenString, _ := token.SignedString([]byte(server.Config.JWTSecret))

	tests := []struct {
		name           string
		roomID         string
		hostToken      string
		expectedStatus int
	}{
		{
			name:           "Delete without token",
			roomID:         "12345",
			hostToken:      "",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Delete with invalid token",
			roomID:         "12345",
			hostToken:      "invalid-token",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Delete existing room",
			roomID:         "12345",
			hostToken:      tokenString,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Delete already deleted room",
			roomID:         "12345",
			hostToken:      tokenString,
			expectedStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodDelete, "/api/rooms/"+tt.roomID, nil)
			req.Header.Set("Authorization", tt.hostToken)
			w := httptest.NewRecorder()
			server.Engine.ServeHTTP(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)
		})
	}
}

func TestServer_CORSHeaders(t *testing.T) {
	server := setupTestServer(t)
	defer server.Metrics.Stop()

	req := httptest.NewRequest(http.MethodOptions, "/api/health", nil)
	w := httptest.NewRecorder()
	server.Engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.Equal(t, "*", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Contains(t, w.Header().Get("Access-Control-Allow-Methods"), "GET")
	assert.Contains(t, w.Header().Get("Access-Control-Allow-Methods"), "POST")
}

func TestServer_RequestSizeLimit(t *testing.T) {
	server := setupTestServer(t)
	defer server.Metrics.Stop()

	// Create a large request body (> 10MB)
	largeBody := make([]byte, 11*1024*1024)
	req := httptest.NewRequest(http.MethodPost, "/api/rooms", bytes.NewBuffer(largeBody))
	req.Header.Set("Content-Type", "application/json")
	req.ContentLength = int64(len(largeBody))
	w := httptest.NewRecorder()
	server.Engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, w.Code)
}

func TestServer_Shutdown(t *testing.T) {
	server := setupTestServer(t)
	defer server.Metrics.Stop()

	// Create some rooms
	room1, _ := server.Handler.Hub.CreateRoom(12345, server.Metrics)
	room2, _ := server.Handler.Hub.CreateRoom(54321, server.Metrics)

	ctx := context.Background()
	err := server.Shutdown(ctx)
	assert.NoError(t, err)

	// Verify rooms are stopped
	time.Sleep(100 * time.Millisecond)
	assert.Equal(t, 0, room1.GetClientCount())
	assert.Equal(t, 0, room2.GetClientCount())
}

func TestServer_Use(t *testing.T) {
	gin.SetMode(gin.TestMode)
	prometheus.DefaultRegisterer = prometheus.NewRegistry()

	hub := websocket.NewHub()
	pool, _ := websocket.NewTaskPool(100)
	handler := websocket.NewHandler(hub, pool)
	logger := logging.NewLogger()
	cfg := &config.Config{
		Port:      "8080",
		JWTSecret: "test-secret-key",
	}

	// Create server without calling NewServer to avoid middleware conflicts
	engine := gin.New()
	metrics := NewMetrics()
	defer metrics.Stop()

	server := &Server{
		Handler: *handler,
		Engine:  engine,
		Addr:    ":8080",
		Logger:  logger,
		Metrics: metrics,
		Config:  cfg,
	}

	var middlewareCalled bool
	testMiddleware := func(c *gin.Context) {
		middlewareCalled = true
		c.Next()
	}

	server.Use(context.Background(), testMiddleware)

	engine.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{})
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()
	server.Engine.ServeHTTP(w, req)

	assert.True(t, middlewareCalled, "Middleware should have been called")
}

func TestServer_MetricsEndpoint(t *testing.T) {
	server := setupTestServer(t)
	defer server.Metrics.Stop()

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	w := httptest.NewRecorder()
	server.Engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "# HELP")
	assert.Contains(t, w.Body.String(), "# TYPE")
}

func TestHashPassword(t *testing.T) {
	password := "testpassword123"
	hashed, err := hashPassword(password)
	require.NoError(t, err)
	assert.NotEmpty(t, hashed)
	assert.NotEqual(t, password, hashed)

	// Verify the hash
	err = bcrypt.CompareHashAndPassword([]byte(hashed), []byte(password))
	assert.NoError(t, err)
}

func TestValidateRoomID(t *testing.T) {
	tests := []struct {
		name        string
		roomIDStr   string
		expectError bool
		expectedID  websocket.ID
	}{
		{"Valid room ID", "12345", false, 12345},
		{"Minimum valid ID", "1", false, 1},
		{"Maximum valid ID", "999999999", false, 999999999},
		{"Invalid format", "abc", true, 0},
		{"Negative number", "-1", true, 0},
		{"Zero", "0", true, 0},
		{"Too large", "1000000000", true, 0},
		{"Empty string", "", true, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			roomID, err := validateRoomID(tt.roomIDStr)
			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expectedID, roomID)
			}
		})
	}
}

func TestGenerateValidRoomID(t *testing.T) {
	for i := 0; i < 100; i++ {
		roomID := generateValidRoomID()
		// Room ID should be either 0 or within valid range
		if roomID != 0 {
			assert.GreaterOrEqual(t, uint32(roomID), uint32(MinRoomID))
			assert.LessOrEqual(t, uint32(roomID), uint32(MaxRoomID))
		}
	}
}

func TestCreateHostJWTToken(t *testing.T) {
	roomID := websocket.ID(12345)
	hostID := "test-host-id"

	token := createHostJWTToken(roomID, hostID)
	require.NotNil(t, token)

	claims, ok := token.Claims.(jwt.MapClaims)
	require.True(t, ok)

	// Check room_id - it's stored as websocket.ID type
	roomIDClaim := claims["room_id"]
	assert.Equal(t, roomID, roomIDClaim)

	assert.Equal(t, hostID, claims["host_id"])
	assert.Equal(t, true, claims["host"])
	assert.NotNil(t, claims["exp"])
}

func TestPrepareRoomOptions(t *testing.T) {
	ctx := context.Background()
	logger := logging.NewLogger()

	tests := []struct {
		name        string
		hostID      string
		password    string
		expectError bool
	}{
		{"Without password", "host-123", "", false},
		{"With password", "host-123", "testpass", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			opts, err := prepareRoomOptions(ctx, logger, tt.hostID, tt.password)
			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
				assert.NotEmpty(t, opts)
			}
		})
	}
}

func TestValidationError(t *testing.T) {
	err := &ValidationError{
		Field:   "test_field",
		Message: "test message",
	}

	assert.Equal(t, "test message", err.Error())
}

func TestAPILoggerMiddleware(t *testing.T) {
	logger := logging.NewLogger()
	middleware := APILoggerMiddleware(logger)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware)
	router.GET("/test", func(c *gin.Context) {
		// Check if request_id is in context
		requestID := c.Request.Context().Value(logging.RequestIDKey)
		assert.NotNil(t, requestID)
		c.JSON(http.StatusOK, gin.H{})
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestParseCreateRoomRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name        string
		body        string
		expectError bool
	}{
		{"Valid JSON", `{"password":"test123"}`, false},
		{"Empty body", "", false},
		{"Invalid JSON", `{invalid}`, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(tt.body))
			c.Request.Header.Set("Content-Type", "application/json")

			req, err := parseCreateRoomRequest(c)
			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, req)
			}
		})
	}
}

func TestConvertRoomIDToString(t *testing.T) {
	tests := []struct {
		name        string
		claims      jwt.MapClaims
		expected    string
		expectError bool
	}{
		{
			name:        "Float64 room_id",
			claims:      jwt.MapClaims{"room_id": float64(12345)},
			expected:    "12345",
			expectError: false,
		},
		{
			name:        "String room_id",
			claims:      jwt.MapClaims{"room_id": "12345"},
			expected:    "12345",
			expectError: false,
		},
		{
			name:        "Invalid type",
			claims:      jwt.MapClaims{"room_id": true},
			expected:    "",
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := convertRoomIDToString(tt.claims)
			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expected, result)
			}
		})
	}
}

func TestVerifyRoomIDMatches(t *testing.T) {
	tests := []struct {
		name        string
		claims      jwt.MapClaims
		roomIDStr   string
		expectError bool
	}{
		{
			name:        "Matching room IDs",
			claims:      jwt.MapClaims{"room_id": float64(12345)},
			roomIDStr:   "12345",
			expectError: false,
		},
		{
			name:        "Non-matching room IDs",
			claims:      jwt.MapClaims{"room_id": float64(12345)},
			roomIDStr:   "54321",
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := verifyRoomIDMatches(tt.claims, tt.roomIDStr)
			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestVerifyHostClaim(t *testing.T) {
	tests := []struct {
		name        string
		claims      jwt.MapClaims
		expectError bool
	}{
		{
			name:        "Valid host claim",
			claims:      jwt.MapClaims{"host": true},
			expectError: false,
		},
		{
			name:        "Invalid host claim (false)",
			claims:      jwt.MapClaims{"host": false},
			expectError: true,
		},
		{
			name:        "Missing host claim",
			claims:      jwt.MapClaims{},
			expectError: true,
		},
		{
			name:        "Invalid host type",
			claims:      jwt.MapClaims{"host": "true"},
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := verifyHostClaim(tt.claims)
			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestServer_Run(t *testing.T) {
	server := setupTestServer(t)
	defer server.Metrics.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	// Run server in goroutine
	errCh := make(chan error, 1)
	go func() {
		errCh <- server.Run(ctx)
	}()

	// Wait for context to be done
	<-ctx.Done()

	// Server should shut down gracefully
	select {
	case err := <-errCh:
		assert.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("Server did not shut down in time")
	}
}
