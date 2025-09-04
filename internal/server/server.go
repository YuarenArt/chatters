package server

import (
	"context"
	"errors"
	"math/rand"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/YuarenArt/chatters/internal/config"
	"github.com/YuarenArt/chatters/internal/logging"
	"github.com/YuarenArt/chatters/pkg/websocket"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"github.com/google/uuid"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
	"golang.org/x/crypto/bcrypt"
)

type CreateRoomResponse struct {
	RoomID    websocket.ID `json:"room_id"`
	HostToken string       `json:"host_token"`
}

type RoomResponse struct {
	RoomID      websocket.ID `json:"room_id"`
	HasPassword bool         `json:"has_password"`
	HostID      string       `json:"host_id,omitempty"`
	ClientCount int          `json:"client_count"`
}

type ErrorResponse struct {
	Code  int    `json:"code"`
	Error string `json:"error"`
}

type Server struct {
	Handler    websocket.Handler
	Engine     *gin.Engine
	Addr       string
	Middleware []gin.HandlerFunc
	Logger     logging.Logger
	Metrics    *Metrics
	Config     *config.Config
}

// Validation constants
const (
	MaxRoomID = 999999999 // Maximum room ID value
	MinRoomID = 1         // Minimum room ID value
)

// hashPassword hashes a password using bcrypt with optimized cost for performance
func hashPassword(password string) (string, error) {
	// Using cost 4 for better performance during testing/development
	// DefaultCost (10) is too expensive for high-load scenarios
	const bcryptCost = 4
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(bytes), err
}

func NewServer(addr string, handler websocket.Handler, serverLogger logging.Logger, cfg *config.Config) *Server {
	apiLogger, _ := logging.NewFileLogger("logs/api.log", false)

	engine := gin.New()
	engine.Use(gin.Recovery())

	metrics := NewMetrics()
	engine.Use(metrics.PrometheusMiddleware())

	// Add CORS middleware
	engine.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Length, Content-Type, Authorization")
		c.Header("Access-Control-Expose-Headers", "Content-Length")
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Max-Age", "43200") // 12 hours

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	})

	// Add request size limit middleware
	engine.Use(func(c *gin.Context) {
		if c.Request.ContentLength > 10*1024*1024 { // 10MB limit
			c.JSON(http.StatusRequestEntityTooLarge, ErrorResponse{
				Code:  http.StatusRequestEntityTooLarge,
				Error: "request too large",
			})
			c.Abort()
			return
		}
		c.Next()
	})

	engine.Use(APILoggerMiddleware(apiLogger))
	engine.GET("/metrics", metrics.MetricsHandler())

	s := &Server{
		Handler: handler,
		Engine:  engine,
		Addr:    addr,
		Logger:  serverLogger,
		Metrics: metrics,
		Config:  cfg,
	}

	s.registerRoutes()

	engine.StaticFS("/static", http.Dir("web/static"))

	engine.GET("/", func(c *gin.Context) {
		c.File("web/static/index.html")
	})

	return s
}

// Health godoc
// @Summary Health check
// @Description Returns server status
// @Tags health
// @Produce json
// @Success 200 {object} map[string]string
// @Router /api/health [get]
func (s *Server) registerRoutes() {

	s.Engine.GET("/ws/:room_id", s.Handler.HandleWebSocketWithJWT(s.Config.JWTSecret))
	api := s.Engine.Group("/api")

	api.POST("/rooms", s.CreateRoom())
	api.GET("/rooms/:room_id", s.Room())
	api.POST("/rooms/:room_id/validate-password", s.ValidatePassword())
	api.POST("/rooms/:room_id/kick", s.KickUser())
	api.PUT("/rooms/:room_id/password", s.ChangePassword())
	api.DELETE("/rooms/:room_id", s.DeleteRoom())

	s.Engine.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
		s.Logger.Log(c.Request.Context(), logging.Debug, "Health check", "status", "ok")
	})

	s.Engine.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	s.Logger.Log(context.Background(), logging.Debug, "Routes registered")
}

// Run starts HTTP server with graceful shutdown support.
func (s *Server) Run(ctx context.Context) error {
	s.Logger.Log(ctx, logging.Info, "Starting server", "addr", s.Addr)

	srv := &http.Server{
		Addr:              s.Addr,
		Handler:           s.Engine,
		ReadTimeout:       10 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	s.Logger.Log(ctx, logging.Info, "Shutting down HTTP server gracefully")
	if err := srv.Shutdown(shutdownCtx); err != nil {
		s.Logger.Log(ctx, logging.Error, "HTTP shutdown error", "error", err)
		return err
	}
	return nil
}

func (s *Server) Use(ctx context.Context, mw ...gin.HandlerFunc) {
	s.Middleware = append(s.Middleware, mw...)
	s.Engine.Use(mw...)
	s.Logger.Log(ctx, logging.Debug, "Middleware added", "count", len(mw))
}

// validateRoomID validates room ID format and range
func validateRoomID(roomIDStr string) (websocket.ID, error) {
	roomIDUint, err := strconv.ParseUint(roomIDStr, 10, 32)
	if err != nil {
		return 0, err
	}

	roomID := websocket.ID(roomIDUint)
	if roomID < MinRoomID || roomID > MaxRoomID {
		return 0, &ValidationError{Field: "room_id", Message: "room ID out of valid range"}
	}

	return roomID, nil
}

// ValidationError represents validation errors
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (e *ValidationError) Error() string {
	return e.Message
}

func APILoggerMiddleware(logger logging.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := uuid.New().String()
		ctx := context.WithValue(c.Request.Context(), "request_id", requestID)
		c.Request = c.Request.WithContext(ctx)

		start := time.Now()
		path := c.Request.URL.Path
		method := c.Request.Method
		clientIP := c.ClientIP()
		contentLength := c.Request.ContentLength

		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()
		responseSize := c.Writer.Size()

		logger.Log(ctx, logging.Info, "HTTP request",
			"method", method,
			"path", path,
			"status", status,
			"latency", latency.String(),
			"client_ip", clientIP,
			"content_length", contentLength,
			"response_size", responseSize,
		)
	}
}

type CreateRoomRequest struct {
	Password string `json:"password,omitempty" example:"mypassword123"`
}

type ValidatePasswordRequest struct {
	Password string `json:"password" example:"mypassword123"`
}

type KickUserRequest struct {
	Username string `json:"username" example:"john_doe"`
}

type ChangePasswordRequest struct {
	NewPassword string `json:"new_password" example:"newpassword456"`
}

// CreateRoom godoc
// @Summary Create a new room
// @Description Generates and creates a new room with a random ID. Optionally set a password for the room.
// @Tags rooms
// @Accept json
// @Produce json
// @Param request body CreateRoomRequest false "Room creation request with optional password"
// @Success 201 {object} CreateRoomResponse "Room created successfully with host token"
// @Failure 400 {object} ErrorResponse "Invalid request"
// @Failure 500 {object} ErrorResponse "Server error"
// @Router /api/rooms [post]
func (s *Server) CreateRoom() func(c *gin.Context) {
	return func(c *gin.Context) {
		ctx := c.Request.Context()

		s.Logger.Log(ctx, logging.Info, "CreateRoom request received",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"client_ip", c.ClientIP(),
			"user_agent", c.Request.UserAgent())

		var req CreateRoomRequest
		// Handle empty request body (optional password)
		if c.Request.ContentLength > 0 {
			if err := c.BindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, ErrorResponse{400, err.Error()})
				return
			}
		}

		var roomID websocket.ID
		var created bool
		maxRetries := 100
		var hostToken *jwt.Token

		for i := 0; i < maxRetries; i++ {
			roomID = websocket.ID(rand.Uint32())
			if roomID < MinRoomID || roomID > MaxRoomID {
				continue
			}

			// Generate host ID for the room creator
			hostID := uuid.New().String()

			hostToken = jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
				"room_id": roomID,
				"host_id": hostID,
				"host":    true,
				"exp":     time.Now().Add(24 * time.Hour).Unix(),
			})

			// Prepare room options
			var opts []websocket.RoomOption
			opts = append(opts, websocket.WithHost(hostID))

			if req.Password != "" {
				hashedPassword, err := hashPassword(req.Password)
				if err != nil {
					s.Logger.Log(ctx, logging.Error, "Failed to hash password", "error", err.Error())
					c.JSON(http.StatusInternalServerError, ErrorResponse{
						Code:  http.StatusInternalServerError,
						Error: "failed to process password",
					})
					return
				}
				opts = append(opts, websocket.WithPassword(hashedPassword))
			}

			_, created = s.Handler.Hub.CreateRoom(roomID, s.Metrics, opts...)
			if created {
				break
			}
		}

		if !created {
			s.Logger.Log(ctx, logging.Error, "Failed to create room after retries",
				"max_retries", maxRetries)
			c.JSON(http.StatusInternalServerError, ErrorResponse{
				Code:  http.StatusInternalServerError,
				Error: "failed to create room after multiple attempts",
			})
			return
		}

		// Sign the JWT token
		tokenString, err := hostToken.SignedString([]byte(s.Config.JWTSecret))
		if err != nil {
			s.Logger.Log(ctx, logging.Error, "Failed to sign JWT token", "error", err.Error())
			c.JSON(http.StatusInternalServerError, ErrorResponse{
				Code:  http.StatusInternalServerError,
				Error: "failed to generate host token",
			})
			return
		}

		s.Logger.Log(ctx, logging.Info, "Room created successfully",
			"room_id", roomID, "retries", maxRetries)
		c.JSON(http.StatusCreated, CreateRoomResponse{RoomID: roomID, HostToken: tokenString})
	}
}

// Room godoc
// @Summary Get room info
// @Description Returns room information by ID
// @Tags rooms
// @Accept json
// @Produce json
// @Param room_id path int true "Room ID"
// @Success 200 {object} RoomResponse
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /api/rooms/{room_id} [get]
func (s *Server) Room() func(c *gin.Context) {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		roomIDStr := c.Param("room_id")

		s.Logger.Log(ctx, logging.Info, "Room info request received",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"room_id", roomIDStr,
			"client_ip", c.ClientIP(),
			"user_agent", c.Request.UserAgent())

		roomID, err := validateRoomID(roomIDStr)
		if err != nil {
			s.Logger.Log(ctx, logging.Warn, "Invalid room ID provided",
				"room_id", roomIDStr, "error", err.Error())
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Code:  http.StatusBadRequest,
				Error: "invalid room ID format or out of range",
			})
			return
		}

		room, exists := s.Handler.Hub.GetRoom(roomID)
		if !exists {
			s.Logger.Log(ctx, logging.Info, "Room not found",
				"room_id", roomID, "requested_id", roomIDStr)
			c.JSON(http.StatusNotFound, ErrorResponse{
				Code:  http.StatusNotFound,
				Error: "room not found",
			})
			return
		}

		s.Logger.Log(ctx, logging.Info, "Room info retrieved successfully",
			"room_id", roomID, "client_count", room.GetClientCount())
		c.JSON(http.StatusOK, RoomResponse{
			RoomID:      room.ID,
			HasPassword: room.HasPassword(),
			HostID:      room.GetHostID(),
			ClientCount: room.GetClientCount(),
		})
	}
}

func (s *Server) Shutdown(ctx context.Context) error {
	s.Logger.Log(ctx, logging.Info, "Shutting down server")

	var wg sync.WaitGroup

	s.Handler.Hub.Rooms.Range(func(key, value any) bool {
		room := value.(*websocket.Room)
		wg.Add(1)
		go func(r *websocket.Room) {
			defer wg.Done()
			r.StopRoom()
		}(room)
		return true
	})

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		s.Logger.Log(ctx, logging.Info, "All rooms stopped")
	case <-time.After(10 * time.Second):
		s.Logger.Log(ctx, logging.Warn, "Shutdown timeout, some rooms may not have stopped gracefully")
	}

	s.Handler.Pool.Release()
	return nil
}

// validateHostToken validates JWT token and checks if user is host
func (s *Server) validateHostToken(tokenString, roomIDStr string) (*jwt.MapClaims, error) {
	if tokenString == "" {
		return nil, errors.New("host token required")
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("invalid signing method")
		}
		return []byte(s.Config.JWTSecret), nil
	})

	if err != nil || !token.Valid {
		return nil, errors.New("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, errors.New("invalid token claims")
	}

	// Verify room_id matches - convert to string for comparison
	var tokenRoomID string
	switch v := claims["room_id"].(type) {
	case float64:
		tokenRoomID = strconv.FormatFloat(v, 'f', 0, 64)
	case string:
		tokenRoomID = v
	default:
		return nil, errors.New("invalid room_id type in token")
	}

	if tokenRoomID != roomIDStr {
		return nil, errors.New("token room_id mismatch")
	}

	// Verify host claim
	if host, ok := claims["host"].(bool); !ok || !host {
		return nil, errors.New("not a host token")
	}

	return &claims, nil
}

// ValidatePassword godoc
// @Summary Validate room password
// @Description Validates password for password-protected room
// @Tags rooms
// @Accept json
// @Produce json
// @Param room_id path int true "Room ID"
// @Param request body ValidatePasswordRequest true "Password validation request"
// @Success 200 {object} map[string]bool
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Router /api/rooms/{room_id}/validate-password [post]
func (s *Server) ValidatePassword() func(c *gin.Context) {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		roomIDStr := c.Param("room_id")

		roomID, err := validateRoomID(roomIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Code:  http.StatusBadRequest,
				Error: "invalid room ID format",
			})
			return
		}

		room, exists := s.Handler.Hub.GetRoom(roomID)
		if !exists {
			c.JSON(http.StatusNotFound, ErrorResponse{
				Code:  http.StatusNotFound,
				Error: "room not found",
			})
			return
		}

		var req ValidatePasswordRequest
		// Handle empty request body
		if c.Request.ContentLength > 0 {
			if err := c.BindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, ErrorResponse{
					Code:  http.StatusBadRequest,
					Error: "invalid request body",
				})
				return
			}
		}

		if !room.HasPassword() {
			c.JSON(http.StatusOK, gin.H{"valid": true})
			return
		}

		err = bcrypt.CompareHashAndPassword([]byte(room.HashedPassword), []byte(req.Password))
		valid := err == nil

		s.Logger.Log(ctx, logging.Info, "Password validation attempt",
			"room_id", roomID, "valid", valid)

		c.JSON(http.StatusOK, gin.H{"valid": valid})
	}
}

// KickUser godoc
// @Summary Kick user from room
// @Description Removes a user from the room (host only)
// @Tags rooms
// @Accept json
// @Produce json
// @Param room_id path int true "Room ID"
// @Param Authorization header string true "Host JWT token"
// @Param request body KickUserRequest true "Kick user request"
// @Success 200 {object} map[string]string
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /api/rooms/{room_id}/kick [post]
func (s *Server) KickUser() func(c *gin.Context) {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		roomIDStr := c.Param("room_id")
		hostToken := c.GetHeader("Authorization")

		roomID, err := validateRoomID(roomIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Code:  http.StatusBadRequest,
				Error: "invalid room ID format",
			})
			return
		}

		_, err = s.validateHostToken(hostToken, roomIDStr)
		if err != nil {
			c.JSON(http.StatusUnauthorized, ErrorResponse{
				Code:  http.StatusUnauthorized,
				Error: "unauthorized: " + err.Error(),
			})
			return
		}

		room, exists := s.Handler.Hub.GetRoom(roomID)
		if !exists {
			c.JSON(http.StatusNotFound, ErrorResponse{
				Code:  http.StatusNotFound,
				Error: "room not found",
			})
			return
		}

		var req KickUserRequest
		// Handle empty request body
		if c.Request.ContentLength > 0 {
			if err := c.BindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, ErrorResponse{
					Code:  http.StatusBadRequest,
					Error: "invalid request body",
				})
				return
			}
		} else {
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Code:  http.StatusBadRequest,
				Error: "username is required",
			})
			return
		}

		kicked := room.KickClient(req.Username)
		if !kicked {
			c.JSON(http.StatusNotFound, ErrorResponse{
				Code:  http.StatusNotFound,
				Error: "user not found in room",
			})
			return
		}

		s.Logger.Log(ctx, logging.Info, "User kicked from room",
			"room_id", roomID, "username", req.Username)

		c.JSON(http.StatusOK, gin.H{"message": "user kicked successfully"})
	}
}

// ChangePassword godoc
// @Summary Change room password
// @Description Changes the password of a room (host only)
// @Tags rooms
// @Accept json
// @Produce json
// @Param room_id path int true "Room ID"
// @Param Authorization header string true "Host JWT token"
// @Param request body ChangePasswordRequest true "Change password request"
// @Success 200 {object} map[string]string
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /api/rooms/{room_id}/password [put]
func (s *Server) ChangePassword() func(c *gin.Context) {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		roomIDStr := c.Param("room_id")
		hostToken := c.GetHeader("Authorization")

		roomID, err := validateRoomID(roomIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Code:  http.StatusBadRequest,
				Error: "invalid room ID format",
			})
			return
		}

		_, err = s.validateHostToken(hostToken, roomIDStr)
		if err != nil {
			c.JSON(http.StatusUnauthorized, ErrorResponse{
				Code:  http.StatusUnauthorized,
				Error: "unauthorized: " + err.Error(),
			})
			return
		}

		room, exists := s.Handler.Hub.GetRoom(roomID)
		if !exists {
			c.JSON(http.StatusNotFound, ErrorResponse{
				Code:  http.StatusNotFound,
				Error: "room not found",
			})
			return
		}

		var req ChangePasswordRequest
		// Handle empty request body
		if c.Request.ContentLength > 0 {
			if err := c.BindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, ErrorResponse{
					Code:  http.StatusBadRequest,
					Error: "invalid request body",
				})
				return
			}
		}

		var hashedPassword string
		if req.NewPassword != "" {
			hashedPassword, err = hashPassword(req.NewPassword)
			if err != nil {
				c.JSON(http.StatusInternalServerError, ErrorResponse{
					Code:  http.StatusInternalServerError,
					Error: "failed to hash password",
				})
				return
			}
		}

		room.SetPassword(hashedPassword)

		s.Logger.Log(ctx, logging.Info, "Room password changed",
			"room_id", roomID, "has_password", req.NewPassword != "")

		c.JSON(http.StatusOK, gin.H{"message": "password changed successfully"})
	}
}

// DeleteRoom godoc
// @Summary Delete room
// @Description Deletes a room (host only)
// @Tags rooms
// @Accept json
// @Produce json
// @Param room_id path int true "Room ID"
// @Param Authorization header string true "Host JWT token"
// @Success 200 {object} map[string]string
// @Failure 400 {object} ErrorResponse
// @Failure 401 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /api/rooms/{room_id} [delete]
func (s *Server) DeleteRoom() func(c *gin.Context) {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		roomIDStr := c.Param("room_id")
		hostToken := c.GetHeader("Authorization")

		roomID, err := validateRoomID(roomIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Code:  http.StatusBadRequest,
				Error: "invalid room ID format",
			})
			return
		}

		_, err = s.validateHostToken(hostToken, roomIDStr)
		if err != nil {
			c.JSON(http.StatusUnauthorized, ErrorResponse{
				Code:  http.StatusUnauthorized,
				Error: "unauthorized: " + err.Error(),
			})
			return
		}

		deleted := s.Handler.Hub.DeleteRoom(roomID)
		if !deleted {
			c.JSON(http.StatusNotFound, ErrorResponse{
				Code:  http.StatusNotFound,
				Error: "room not found",
			})
			return
		}

		s.Logger.Log(ctx, logging.Info, "Room deleted",
			"room_id", roomID)

		c.JSON(http.StatusOK, gin.H{"message": "room deleted successfully"})
	}
}
