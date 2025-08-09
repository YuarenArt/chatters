package server

import (
	"context"
	"math/rand"
	"net/http"
	"strconv"
	"time"

	"github.com/YuarenArt/chatters/internal/logging"
	"github.com/YuarenArt/chatters/pkg/websocket"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

type CreateRoomResponse struct {
	RoomID websocket.ID `json:"room_id"`
}

type RoomResponse struct {
	RoomID websocket.ID `json:"room_id"`
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
}

// Validation constants
const (
	MaxRoomID = 999999999 // Maximum room ID value
	MinRoomID = 1         // Minimum room ID value
)

func NewServer(addr string, handler websocket.Handler, serverLogger logging.Logger) *Server {
	apiLogger, _ := logging.NewFileLogger("logs/api.log", false)

	engine := gin.New()
	engine.Use(gin.Recovery())

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

	s := &Server{
		Handler: handler,
		Engine:  engine,
		Addr:    addr,
		Logger:  serverLogger,
	}

	s.registerRoutes()

	return s
}

// Health godoc
// @Summary      Health check
// @Description  Returns server status
// @Tags         health
// @Produce      json
// @Success      200  {object}  map[string]string
// @Router       /health [get]
func (s *Server) registerRoutes() {
	api := s.Engine.Group("/")

	api.GET("/ws/:room_id", s.Handler.HandleWebSocket)
	api.POST("/rooms", s.CreateRoom())
	api.GET("/rooms/:room_id", s.Room())

	s.Engine.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
		s.Logger.Log(c.Request.Context(), logging.Debug, "Health check", "status", "ok")
	})

	s.Engine.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	s.Logger.Log(context.Background(), logging.Debug, "Routes registered")
}

func (s *Server) Run(ctx context.Context) error {
	s.Logger.Log(ctx, logging.Info, "Starting server", "addr", s.Addr)
	return s.Engine.Run(s.Addr)
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
		userAgent := c.Request.UserAgent()
		clientIP := c.ClientIP()
		contentLength := c.Request.ContentLength

		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()
		responseSize := c.Writer.Size()

		// Enhanced logging with more context
		logger.Log(ctx, logging.Info, "HTTP request",
			"method", method,
			"path", path,
			"status", status,
			"latency", latency.String(),
			"client_ip", clientIP,
			"user_agent", userAgent,
			"content_length", contentLength,
			"response_size", responseSize,
			"request_id", requestID,
		)
	}
}

// CreateRoom godoc
// @Summary      Create a new room
// @Description  Generates and creates a new room with a random ID
// @Tags         rooms
// @Accept       json
// @Produce      json
// @Success      201  {object}  CreateRoomResponse
// @Failure      409  {object}  ErrorResponse
// @Failure      500  {object}  ErrorResponse
// @Router       /rooms [post]
func (s *Server) CreateRoom() func(c *gin.Context) {
	return func(c *gin.Context) {
		ctx := c.Request.Context()

		// Логируем входящий запрос
		s.Logger.Log(ctx, logging.Info, "CreateRoom request received",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"client_ip", c.ClientIP(),
			"user_agent", c.Request.UserAgent())

		// Generate room ID with retry logic for collision handling
		var roomID websocket.ID
		var created bool
		maxRetries := 10

		for i := 0; i < maxRetries; i++ {
			roomID = websocket.ID(rand.Uint32())
			if roomID < MinRoomID || roomID > MaxRoomID {
				continue // Skip invalid IDs
			}

			_, created = s.Handler.Hub.CreateRoom(roomID)
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

		s.Logger.Log(ctx, logging.Info, "Room created successfully",
			"room_id", roomID, "retries", maxRetries)
		c.JSON(http.StatusCreated, CreateRoomResponse{RoomID: roomID})
	}
}

// Room godoc
// @Summary      Get room info
// @Description  Returns room information by ID
// @Tags         rooms
// @Accept       json
// @Produce      json
// @Param        room_id  path      int  true  "Room ID"
// @Success      200  {object}  RoomResponse
// @Failure      400  {object}  ErrorResponse
// @Failure      404  {object}  ErrorResponse
// @Router       /rooms/{room_id} [get]
func (s *Server) Room() func(c *gin.Context) {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		roomIDStr := c.Param("room_id")

		// Логируем входящий запрос
		s.Logger.Log(ctx, logging.Info, "Room info request received",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"room_id", roomIDStr,
			"client_ip", c.ClientIP(),
			"user_agent", c.Request.UserAgent())

		// Validate room ID
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
		c.JSON(http.StatusOK, RoomResponse{RoomID: room.ID})
	}
}

func (s *Server) Shutdown(ctx context.Context) error {
	s.Logger.Log(ctx, logging.Info, "Shutting down server")

	s.Handler.Hub.Rooms.Range(func(key, value any) bool {
		room := value.(*websocket.Room)
		room.StopRoom()
		return true
	})

	s.Handler.Pool.Release()
	return nil
}
